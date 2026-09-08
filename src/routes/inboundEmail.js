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

    const categoriesResult = await pool.query('SELECT * FROM Categories WHERE companyId = $1 ORDER BY id LIMIT 1', [companyId])
    const defaultCategory = categoriesResult.rows[0]?.name || 'General'
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
      'INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [ticketId, subject || 'No subject', body, defaultCategory, defaultPriority, assignedTo, senderEmail, companyId, clientOrgId, initialStatus]
    )

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
      `
    )

    res.status(200).json({ ticketId })
  } catch (err) {
    console.error('Inbound email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router