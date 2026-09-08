const express = require('express')
const router = express.Router()
const { Resend } = require('resend')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')

const resend = new Resend(process.env.RESEND_API_KEY)

function generateTicketBodyFromEmail(text, html) {
  if (text) return text.trim()
  if (html) return html.replace(/<[^>]+>/g, ' ').trim()
  return ''
}

function autoAssignAgent(agents, ticketList, category, priority) {
  const isCritical = priority === 'Urgent' || priority === 'High'
  let matched = agents.filter(a => a.skills && a.skills.split(',').includes(category))
  if (matched.length === 0) matched = [...agents]
  if (matched.length === 0) return null

  if (isCritical) {
    const seniors = matched.filter(a => a.level === 'Senior')
    if (seniors.length > 0) matched = seniors
  } else {
    const juniors = matched.filter(a => a.level === 'Junior')
    if (juniors.length > 0) matched = juniors
  }

  const agentLoad = matched.map(agent => ({
    agent,
    count: ticketList.filter(t => t.assignedto === agent.name && t.status !== 'Resolved').length
  }))
  agentLoad.sort((a, b) => a.count - b.count)
  return agentLoad[0].agent.name
}

router.post('/', async (req, res) => {
  try {
    const payload = req.body
    if (payload.type !== 'email.received') {
      return res.status(200).json({ ignored: true })
    }

    const { email_id, from, subject } = payload.data

    const { data: email, error } = await resend.emails.receiving.get(email_id)
    if (error) {
      console.error('Failed to fetch inbound email content:', error.message)
      return res.status(200).json({ error: 'fetch_failed' })
    }

    const senderEmail = from.includes('<') ? from.match(/<(.+)>/)[1] : from
    const body = generateTicketBodyFromEmail(email.text, email.html)

    const userResult = await pool.query('SELECT * FROM Users WHERE email = $1', [senderEmail])

    if (userResult.rows.length === 0) {
      sendEmail(
        senderEmail,
        'Unable to create ticket',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #DC2626;">We couldn't create a ticket</h1>
            <p>This email address isn't registered with KrishaSure. Please contact your account administrator to be set up, or log in directly to raise a ticket.</p>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
      return res.status(200).json({ handled: 'unknown_sender' })
    }

    const user = userResult.rows[0]
    const companyId = user.companyid
    const clientOrgId = user.clientorgid || null

    const categoriesResult = await pool.query("SELECT * FROM Categories WHERE companyId = $1 AND name = 'General' LIMIT 1", [companyId])
let defaultCategory = categoriesResult.rows[0]?.name

if (!defaultCategory) {
  const fallbackResult = await pool.query('SELECT * FROM Categories WHERE companyId = $1 ORDER BY id LIMIT 1', [companyId])
  defaultCategory = fallbackResult.rows[0]?.name || 'General'
}
    const defaultPriority = 'Medium'

    const agentsResult = await pool.query('SELECT * FROM Agents WHERE companyId = $1', [companyId])
    const ticketsResult = await pool.query('SELECT * FROM Tickets WHERE companyId = $1', [companyId])
    const assignedTo = autoAssignAgent(agentsResult.rows, ticketsResult.rows, defaultCategory, defaultPriority)

    const countResult = await pool.query(
      "SELECT ticketId FROM Tickets WHERE companyId = $1 ORDER BY id DESC LIMIT 1",
      [companyId]
    )
    let nextNum = 1
    if (countResult.rows.length > 0) {
      const lastId = countResult.rows[0].ticketid
      const lastNum = parseInt(lastId.split('-')[1])
      nextNum = lastNum + 1
    }
    const ticketId = `KS-${String(nextNum).padStart(3, '0')}`
    const initialStatus = assignedTo ? 'Open/Assigned' : 'Open/Unassigned'

    await pool.query(
      'INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId, status, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [ticketId, subject || 'No subject', body, defaultCategory, defaultPriority, assignedTo, senderEmail, companyId, clientOrgId, initialStatus, 'email']
    )

    const admins = await pool.query("SELECT email FROM Users WHERE role IN ('superadmin', 'admin') AND companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    if (assignedTo) {
      const agentEmailResult = await pool.query(
        'SELECT email FROM Users WHERE name = $1 AND companyId = $2',
        [assignedTo, companyId]
      )
      const agentEmailAddress = agentEmailResult.rows[0]?.email

      if (agentEmailAddress) {
        sendEmail(
          agentEmailAddress,
          `New Ticket Assigned (via Email) - ${ticketId}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #0A2540;">New Ticket - Auto-Created from Email</h1>
              <p>This ticket was created automatically from an incoming email to support@krishasure.io, and auto-assigned to you.</p>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>From</strong></td><td style="padding: 8px;">${senderEmail}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Subject</strong></td><td style="padding: 8px;">${subject}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Category / Priority</strong></td><td style="padding: 8px;">${defaultCategory} / ${defaultPriority} (default, not confirmed by client)</td></tr>
              </table>
              <p>Log in to KrishaSure to review the full message, adjust the category or priority, or reassign it to a different agent if it's not the right fit for you.</p>
              <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
              <br/><br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `,
          adminEmails
        )
      }
    }

    sendEmail(
      senderEmail,
      `Ticket ${ticketId} Created - ${subject}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Ticket Created Successfully!!</h1>
          <p>We've created ticket <strong>${ticketId}</strong> from your email.</p>
          <p>Category: ${defaultCategory} · Priority: ${defaultPriority}</p>
          <p>You can log in to KrishaSure to track progress, add details, or adjust the category and priority.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      adminEmails
    )

    res.status(200).json({ ticketId })
  } catch (err) {
    console.error('Inbound email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router