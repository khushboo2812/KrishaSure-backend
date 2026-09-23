const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getTicketReplyFromAddress } = require('./supportEmail')

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Emails everyone involved in a ticket (the client, the assigned agent
// and anyone who has commented) about a new comment, except its author.
// The subject carries the ticket ID so a reply to this email is added
// back onto the same ticket (see routes/inboundEmail.js).
async function notifyNewComment({ ticket, authorName, authorEmail, comment }) {
  const agentResult = await pool.query(
    'SELECT email FROM Agents WHERE name = $1 AND companyId = $2',
    [ticket.assignedto, ticket.companyid]
  )
  const agentEmail = agentResult.rows[0]?.email

  const priorCommenters = await pool.query(
    'SELECT DISTINCT authorEmail FROM TicketComments WHERE ticketId = $1',
    [ticket.id]
  )

  const recipients = new Set()
  if (ticket.clientemail) recipients.add(ticket.clientemail.toLowerCase())
  if (agentEmail) recipients.add(agentEmail.toLowerCase())
  priorCommenters.rows.forEach(row => row.authoremail && recipients.add(row.authoremail.toLowerCase()))
  recipients.delete((authorEmail || '').toLowerCase())

  const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId: ticket.companyid, clientOrgId: ticket.clientorgid })

  recipients.forEach(recipient => {
    sendEmail(
      recipient,
      `New Comment on Ticket ${ticket.ticketid}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">New Comment Added</h1>
          <p><strong>${escapeHtml(authorName)}</strong> added a comment on ticket <strong>${ticket.ticketid}</strong>:</p>
          <div style="background: #f4f7fb; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(comment)}</p>
          </div>
          <p style="color: #64748B; font-size: 13px;">Reply to this email to add a comment to the ticket.</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Ticket</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      null,
      replyFromAddress
    )
  })
}

module.exports = { notifyNewComment, escapeHtml }
