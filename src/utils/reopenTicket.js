const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getTicketReplyFromAddress } = require('./supportEmail')
const { EMAIL_LOGO } = require('./emailBranding')

// A resolved ticket can be reopened for this long after it was
// resolved; after that the client raises a new ticket.
const REOPEN_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

// 'ok' | 'not_resolved' | 'expired' — shared by the Reopen button
// (routes/tickets.js) and a client replying to the ticket by email
// (routes/inboundEmail.js) so both follow the same rule.
function reopenEligibility(ticket, now = new Date()) {
  if (ticket.status !== 'Resolved') return 'not_resolved'
  const daysSinceResolved = (new Date(now) - new Date(ticket.resolvedat)) / DAY_MS
  return daysSinceResolved > REOPEN_WINDOW_DAYS ? 'expired' : 'ok'
}

// Puts a resolved ticket back with the same agent. reopenedAt marks the
// start of the new round — the live "open for"/SLA math (see
// reports.js's getTimerStart) uses it instead of the ticket's original
// createdAt, so a ticket that already used up its SLA window before its
// first resolution doesn't read as instantly breached again the moment
// it's reopened. createdAt itself is left untouched — ticket age and
// sort order elsewhere still reflect when it was actually first filed.
//
// `WHERE status = 'Resolved'` makes this safe if two things try to
// reopen the same ticket at once: the second changes nothing and this
// returns false.
async function reopenTicket(ticket, { byName }) {
  const newStatus = ticket.assignedto ? 'Open/Assigned' : 'Open/Unassigned'
  const result = await pool.query(
    `UPDATE Tickets SET status = $2, reopenedAt = NOW(), pausedBusinessHours = 0, pendingSince = NULL, pendingReminderSentAt = NULL, escalatedCount = 0, escalatedAt = NULL, slaWarningSentAt = NULL, escalationAlertSentAt = NULL
     WHERE id = $1 AND status = 'Resolved'`,
    [ticket.id, newStatus]
  )
  if (result.rowCount === 0) return false

  await pool.query('INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)', [ticket.id, 'Reopened', byName])

  const admins = await pool.query("SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1", [ticket.companyid])
  const adminEmails = admins.rows.map(a => a.email).join(',')
  const agentResult = await pool.query(
    'SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE p.name = $1 AND m.companyId = $2',
    [ticket.assignedto, ticket.companyid]
  )
  const agentEmail = agentResult.rows[0]?.email
  const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })

  sendEmail(
    ticket.clientemail,
    `Ticket ${ticket.ticketid} Reopened`,
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${EMAIL_LOGO}
        <h1 style="color: #F59E0B;">Ticket Reopened</h1>
        <p>Ticket <strong>${ticket.ticketid}</strong> has been reopened by ${byName}.</p>
        <p>It has been reassigned to <strong>${ticket.assignedto}</strong> for follow up.</p>
        <br/>
        <p style="color: #64748B; font-size: 12px;">KrishaSure · Powered by Krisha Solutions</p>
      </div>
    `,
    agentEmail ? `${agentEmail},${adminEmails}` : adminEmails,
    replyFromAddress
  )
  return true
}

// Sent when a client replies to a ticket resolved more than
// REOPEN_WINDOW_DAYS ago: their reply is kept as a comment, but the
// ticket stays closed, so they need to know to start a new one.
async function sendTooOldToReopen(ticket) {
  const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })
  sendEmail(
    ticket.clientemail,
    `Ticket ${ticket.ticketid} is closed - please raise a new ticket`,
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${EMAIL_LOGO}
        <h1 style="color: #0A2540;">This ticket can't be reopened</h1>
        <p>Ticket <strong>${ticket.ticketid}</strong> was resolved more than ${REOPEN_WINDOW_DAYS / 7} weeks ago, so it can no longer be reopened. We've kept your message on the ticket.</p>
        <p>Please send a new email to this address, or raise a new ticket in KrishaSure, and we'll pick it up from there.</p>
        <br/>
        <p style="color: #64748B; font-size: 12px;">KrishaSure · Powered by Krisha Solutions</p>
      </div>
    `,
    null,
    replyFromAddress
  )
}

module.exports = { REOPEN_WINDOW_DAYS, reopenEligibility, reopenTicket, sendTooOldToReopen }
