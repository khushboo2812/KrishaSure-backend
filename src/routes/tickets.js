const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')

// GET all tickets - filtered by company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await sql.query`SELECT * FROM Tickets WHERE companyId = ${companyId} ORDER BY createdAt DESC`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET ticket by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const result = await sql.query`SELECT * FROM Tickets WHERE id = ${id} AND companyId = ${companyId}`
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create ticket
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { ticketId, title, description, category, priority, assignedTo, clientEmail } = req.body
    
    await sql.query`
      INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId)
      VALUES (${ticketId}, ${title}, ${description}, ${category}, ${priority}, ${assignedTo}, ${clientEmail}, ${companyId})
    `

    const admins = await sql.query`SELECT email FROM Users WHERE role IN ('superadmin', 'admin') AND companyId = ${companyId}`
    const adminEmails = admins.recordset.map(a => a.email).join(',')

    const agentResult = await sql.query`SELECT email FROM Users WHERE name = ${assignedTo} AND companyId = ${companyId}`
    const agentEmail = agentResult.recordset[0]?.email

    sendEmail(
      clientEmail,
      `Ticket ${ticketId} Created - ${title}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Ticket Created Successfully!!</h1>
          <p>Your support ticket has been raised and assigned to our team!!</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${title}</td></tr>
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Category</strong></td><td style="padding: 8px;">${category}</td></tr>
            <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Priority</strong></td><td style="padding: 8px;">${priority}</td></tr>
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
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${title}</td></tr>
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

// PUT update ticket
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { status, assignedTo, resolvedAt } = req.body

    const ticketResult = await sql.query`SELECT * FROM Tickets WHERE id = ${id} AND companyId = ${companyId}`
    const ticket = ticketResult.recordset[0]

    await sql.query`
      UPDATE Tickets 
      SET status = ${status}, assignedTo = ${assignedTo}, resolvedAt = ${resolvedAt}
      WHERE id = ${id} AND companyId = ${companyId}
    `

    const admins = await sql.query`SELECT email FROM Users WHERE role IN ('superadmin', 'admin') AND companyId = ${companyId}`
    const adminEmails = admins.recordset.map(a => a.email).join(',')

    if (status === "Resolved" && ticket) {
      sendEmail(
        ticket.clientEmail,
        `Ticket ${ticket.ticketId} Resolved!! ✅`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #16A34A;">Your Ticket has been Resolved!!</h1>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Resolved By</strong></td><td style="padding: 8px;">${ticket.assignedTo}</td></tr>
            </table>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )

      if (adminEmails) {
        sendEmail(
          adminEmails,
          `[CC] Ticket ${ticket.ticketId} Resolved`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #16A34A;">Ticket Resolved</h1>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketId}</td></tr>
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