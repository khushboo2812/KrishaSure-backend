const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getTicketReplyFromAddress } = require('./supportEmail')
const { businessHoursElapsed, getEffectiveBusinessHours } = require('./businessHours')
const { workingDaysBetween } = require('./workingDays')
const { escapeHtml } = require('./commentNotifications')

const PENDING_REMINDER_WORKING_DAYS = 3
const PENDING_AUTO_CLOSE_WORKING_DAYS = 5

async function getTicketBusinessHours(ticket) {
  const companyResult = await pool.query(
    'SELECT businessDays, businessHoursStart, businessHoursEnd, timezone FROM Companies WHERE id = $1',
    [ticket.companyid]
  )
  const c = companyResult.rows[0]
  const companyHours = c && { businessDays: c.businessdays, businessHoursStart: c.businesshoursstart, businessHoursEnd: c.businesshoursend, timezone: c.timezone }

  let orgHours = null
  if (ticket.clientorgid) {
    const orgResult = await pool.query(
      'SELECT businessDays, businessHoursStart, businessHoursEnd, timezone FROM ClientOrganizations WHERE id = $1',
      [ticket.clientorgid]
    )
    const o = orgResult.rows[0]
    orgHours = o && { businessDays: o.businessdays, businessHoursStart: o.businesshoursstart, businessHoursEnd: o.businesshoursend, timezone: o.timezone }
  }
  return getEffectiveBusinessHours(companyHours, orgHours)
}

// Business hours the current Pending period has lasted so far — added
// to pausedBusinessHours whenever a ticket leaves Pending, so the SLA
// clock skips it. Only counts from the start of the current round, in
// case a ticket went Pending before being reopened.
async function currentPendingHours(ticket, now = new Date()) {
  if (!ticket.pendingsince) return 0
  const roundStart = ticket.reopenedat || ticket.createdat
  const from = new Date(ticket.pendingsince) > new Date(roundStart) ? ticket.pendingsince : roundStart
  return businessHoursElapsed(from, now, await getTicketBusinessHours(ticket))
}

async function getAgentEmail(ticket) {
  if (!ticket.assignedto) return null
  const result = await pool.query('SELECT email FROM Agents WHERE name = $1 AND companyId = $2', [ticket.assignedto, ticket.companyid])
  return result.rows[0]?.email || null
}

function emailShell(heading, bodyHtml, headingColor = '#0A2540') {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: ${headingColor};">${heading}</h1>
      ${bodyHtml}
      <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
      <br/><br/>
      <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
    </div>
  `
}

async function markPending(ticket, { note, byName, byEmail }) {
  await pool.query(
    "UPDATE Tickets SET status = 'Pending', pendingSince = NOW(), pendingReminderSentAt = NULL WHERE id = $1",
    [ticket.id]
  )
  await pool.query(
    'INSERT INTO TicketComments (ticketId, authorName, authorEmail, comment) VALUES ($1, $2, $3, $4)',
    [ticket.id, byName, byEmail, `Waiting on client: ${note}`]
  )
  await pool.query('INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)', [ticket.id, 'Pending', byName])

  const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })
  sendEmail(
    ticket.clientemail,
    `Ticket ${ticket.ticketid} - we need your input`,
    emailShell('We need your input', `
      <p><strong>${escapeHtml(byName)}</strong> is working on ticket <strong>${ticket.ticketid}</strong> (${escapeHtml(ticket.title)}) and needs the following from you:</p>
      <div style="background: #f4f7fb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(note)}</p>
      </div>
      <p>Reply to this email, or add a comment on the ticket in KrishaSure.</p>
      <p style="color: #64748B; font-size: 13px;">If we don't hear back within ${PENDING_AUTO_CLOSE_WORKING_DAYS} working days, the ticket will be closed. You can reopen it any time within 2 weeks.</p>
    `),
    null,
    replyFromAddress
  )
}

// Moves a Pending ticket back into the agent's queue and banks the time
// it spent Pending. `WHERE status = 'Pending'` makes this safe to call
// twice for the same reply (the second call changes nothing).
async function resumeFromPending(ticket, { byName, notifyAgent = true } = {}) {
  const pausedHours = await currentPendingHours(ticket)
  const newStatus = ticket.assignedto ? 'Open/Assigned' : 'Open/Unassigned'
  const result = await pool.query(
    `UPDATE Tickets SET status = $1, pausedBusinessHours = pausedBusinessHours + $2, pendingSince = NULL, pendingReminderSentAt = NULL
     WHERE id = $3 AND status = 'Pending'`,
    [newStatus, pausedHours, ticket.id]
  )
  if (result.rowCount === 0) return false

  await pool.query('INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)', [ticket.id, 'Resumed', byName])

  const agentEmail = notifyAgent ? await getAgentEmail(ticket) : null
  if (agentEmail) {
    const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })
    sendEmail(
      agentEmail,
      `Client replied - Ticket ${ticket.ticketid} is back in your queue`,
      emailShell('The client replied', `
        <p><strong>${escapeHtml(byName)}</strong> replied on ticket <strong>${ticket.ticketid}</strong> (${escapeHtml(ticket.title)}). It's no longer Pending and the SLA clock has resumed.</p>
      `),
      null,
      replyFromAddress
    )
  }
  return true
}

// Hourly job (see index.js): a Pending ticket gets one reminder to the
// client after PENDING_REMINDER_WORKING_DAYS, and is resolved after
// PENDING_AUTO_CLOSE_WORKING_DAYS with no reply. Working days are
// Mon-Fri, same coarse count as the user-limit grace period.
async function runPendingFollowUps(now = new Date()) {
  const pending = await pool.query("SELECT * FROM Tickets WHERE status = 'Pending' AND pendingSince IS NOT NULL")

  for (const ticket of pending.rows) {
    try {
      const waited = workingDaysBetween(ticket.pendingsince, now)
      const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })

      if (waited >= PENDING_AUTO_CLOSE_WORKING_DAYS) {
        const pausedHours = await currentPendingHours(ticket, now)
        const result = await pool.query(
          `UPDATE Tickets SET status = 'Resolved', resolvedAt = NOW(), pausedBusinessHours = pausedBusinessHours + $1, pendingSince = NULL, pendingReminderSentAt = NULL
           WHERE id = $2 AND status = 'Pending'`,
          [pausedHours, ticket.id]
        )
        if (result.rowCount === 0) continue
        await pool.query('INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)', [ticket.id, 'Auto-resolved (no client reply)', 'KrishaSure'])

        const agentEmail = await getAgentEmail(ticket)
        sendEmail(
          ticket.clientemail,
          `Ticket ${ticket.ticketid} closed - no reply received`,
          emailShell('Ticket closed', `
            <p>We didn't hear back on ticket <strong>${ticket.ticketid}</strong> (${escapeHtml(ticket.title)}) for ${PENDING_AUTO_CLOSE_WORKING_DAYS} working days, so we've closed it.</p>
            <p>If you still need help, reopen it in KrishaSure within 2 weeks, or raise a new ticket.</p>
          `, '#64748B'),
          agentEmail,
          replyFromAddress
        )
      } else if (waited >= PENDING_REMINDER_WORKING_DAYS && !ticket.pendingremindersentat) {
        const result = await pool.query(
          "UPDATE Tickets SET pendingReminderSentAt = NOW() WHERE id = $1 AND status = 'Pending' AND pendingReminderSentAt IS NULL",
          [ticket.id]
        )
        if (result.rowCount === 0) continue
        sendEmail(
          ticket.clientemail,
          `Reminder: Ticket ${ticket.ticketid} is waiting on your reply`,
          emailShell('We are still waiting on your reply', `
            <p>Ticket <strong>${ticket.ticketid}</strong> (${escapeHtml(ticket.title)}) is on hold until we hear back from you. Please reply to this email or add a comment in KrishaSure.</p>
            <p style="color: #64748B; font-size: 13px;">If we don't hear back within ${PENDING_AUTO_CLOSE_WORKING_DAYS - waited} more working day${PENDING_AUTO_CLOSE_WORKING_DAYS - waited === 1 ? '' : 's'}, the ticket will be closed.</p>
          `, '#D97706'),
          null,
          replyFromAddress
        )
      }
    } catch (err) {
      console.error(`Pending follow-up failed for ticket ${ticket.ticketid}:`, err.message)
    }
  }
}

module.exports = {
  markPending,
  resumeFromPending,
  currentPendingHours,
  runPendingFollowUps,
  PENDING_REMINDER_WORKING_DAYS,
  PENDING_AUTO_CLOSE_WORKING_DAYS
}
