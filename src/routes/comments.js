const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')

router.get('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
    const result = await pool.query(
      'SELECT * FROM TicketComments WHERE ticketId = $1 ORDER BY createdAt ASC',
      [ticketId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
    const { comment } = req.body
    const { name, email } = req.user

    await pool.query(
      'INSERT INTO TicketComments (ticketId, authorName, authorEmail, comment) VALUES ($1, $2, $3, $4)',
      [ticketId, name, email, comment]
    )

    const ticketResult = await pool.query('SELECT * FROM Tickets WHERE id = $1', [ticketId])
    const ticket = ticketResult.rows[0]

    if (ticket) {
      const agentResult = await pool.query(
        'SELECT email FROM Users WHERE name = $1 AND companyId = $2',
        [ticket.assignedto, ticket.companyid]
      )
      const agentEmail = agentResult.rows[0]?.email

      // Get everyone who has commented before
      const priorCommenters = await pool.query(
        'SELECT DISTINCT authorEmail FROM TicketComments WHERE ticketId = $1',
        [ticketId]
      )

      const recipients = new Set()
      if (ticket.clientemail) recipients.add(ticket.clientemail)
      if (agentEmail) recipients.add(agentEmail)
      priorCommenters.rows.forEach(row => recipients.add(row.authoremail))

      // Remove the current commenter (don't notify themselves)
      recipients.delete(email)

      recipients.forEach(recipient => {
        sendEmail(
          recipient,
          `New Comment on Ticket ${ticket.ticketid}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #0A2540;">New Comment Added</h1>
              <p><strong>${name}</strong> added a comment on ticket <strong>${ticket.ticketid}</strong>:</p>
              <div style="background: #f4f7fb; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 0;">${comment}</p>
              </div>
              <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Ticket</a>
              <br/><br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `
        )
      })
    }

    res.status(201).json({ message: 'Comment added successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router