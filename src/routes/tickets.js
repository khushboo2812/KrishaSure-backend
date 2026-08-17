const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM Tickets WHERE companyId = $1 ORDER BY createdAt DESC', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM Tickets WHERE id = $1 AND companyId = $2', [id, companyId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { ticketId, title, description, category, priority, assignedTo, clientEmail } = req.body
    
    await pool.query(
      'INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ticketId, title, description, category, priority, assignedTo, clientEmail, companyId]
    )

    const admins = await pool.query("SELECT email FROM Users WHERE role IN ('superadmin', 'admin') AND companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    const agentResult = await pool.query('SELECT email FROM Users WHERE name = $1 AND companyId = $2', [assignedTo, companyId])
    const agentEmail = agentResult.rows[0]?.email

    sendEmail(
      clientEmail,
      `Ticket ${ticketId} Created - ${title}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Ticket Created Successfully!!</h1>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${title}</td></tr>
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Assigned To</strong></td><td style="padding: 8px;">${assignedTo}</td></tr>
          </table>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    if (agentEmail) {
      sendEmail(
        agentEmail,
        `New Ticket Assigned - ${ticketId}`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0A2540;">New Ticket Assigned to You!!</h1>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${clientEmail}</td></tr>
            </table>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
    }

    if (adminEmails) {
      sendEmail(
        adminEmails,
        `[CC] New Ticket ${ticketId} - ${title}`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0A2540;">New Ticket Created</h1>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Assigned To</strong></td><td style="padding: 8px;">${assignedTo}</td></tr>
            </table>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
    }

    res.status(201).json({ message: 'Ticket created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { status, assignedTo, resolvedAt } = req.body

    const ticketResult = await pool.query('SELECT * FROM Tickets WHERE id = $1 AND companyId = $2', [id, companyId])
    const ticket = ticketResult.rows[0]

    await pool.query(
      'UPDATE Tickets SET status = $1, assignedTo = $2, resolvedAt = $3 WHERE id = $4 AND companyId = $5',
      [status, assignedTo, resolvedAt, id, companyId]
    )

    const admins = await pool.query("SELECT email FROM Users WHERE role IN ('superadmin', 'admin') AND companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    if (status === "Resolved" && ticket) {
      sendEmail(
        ticket.clientemail,
        `Ticket ${ticket.ticketid} Resolved!! ✅`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #16A34A;">Your Ticket has been Resolved!!</h1>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketid}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Resolved By</strong></td><td style="padding: 8px;">${ticket.assignedto}</td></tr>
            </table>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )

      if (adminEmails) {
        sendEmail(
          adminEmails,
          `[CC] Ticket ${ticket.ticketid} Resolved`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #16A34A;">Ticket Resolved</h1>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketid}</td></tr>
              </table>
              <br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `
        )
      }
    }

    res.json({ message: 'Ticket updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router