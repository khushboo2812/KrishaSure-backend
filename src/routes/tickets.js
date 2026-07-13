const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')
const { sendEmail } = require('../config/email')

// GET all tickets
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`SELECT * FROM Tickets ORDER BY createdAt DESC`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET ticket by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await sql.query`SELECT * FROM Tickets WHERE id = ${id}`
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create ticket
router.post('/', async (req, res) => {
  try {
    const { ticketId, title, description, category, priority, assignedTo, clientEmail } = req.body
    
    await sql.query`
      INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail)
      VALUES (${ticketId}, ${title}, ${description}, ${category}, ${priority}, ${assignedTo}, ${clientEmail})
    `

    // Get admin emails
    const admins = await sql.query`SELECT email FROM Users WHERE role IN ('superadmin', 'admin')`
    const adminEmails = admins.recordset.map(a => a.email).join(',')

    // Get agent email
    const agentResult = await sql.query`SELECT email FROM Users WHERE name = ${assignedTo}`
    const agentEmail = agentResult.recordset[0]?.email

    // Email to client
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

    // Email to agent
    if (agentEmail) {
      sendEmail(
        agentEmail,
        `New Ticket Assigned - ${ticketId}`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0A2540;">New Ticket Assigned to You!!</h1>
            <p>A new support ticket has been assigned to you!!</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${title}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Category</strong></td><td style="padding: 8px;">${category}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Priority</strong></td><td style="padding: 8px;">${priority}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${clientEmail}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Description</strong></td><td style="padding: 8px;">${description || 'No description'}</td></tr>
            </table>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
    }

    // CC admins
    if (adminEmails) {
      sendEmail(
        adminEmails,
        `[CC] New Ticket ${ticketId} - ${title}`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0A2540;">New Ticket Created</h1>
            <p>A new ticket has been created and assigned!!</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${title}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Priority</strong></td><td style="padding: 8px;">${priority}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Assigned To</strong></td><td style="padding: 8px;">${assignedTo}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${clientEmail}</td></tr>
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
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { status, assignedTo, resolvedAt } = req.body

    // Get ticket details before update
    const ticketResult = await sql.query`SELECT * FROM Tickets WHERE id = ${id}`
    const ticket = ticketResult.recordset[0]

    await sql.query`
      UPDATE Tickets 
      SET status = ${status}, assignedTo = ${assignedTo}, resolvedAt = ${resolvedAt}
      WHERE id = ${id}
    `

    // Get admin emails
    const admins = await sql.query`SELECT email FROM Users WHERE role IN ('superadmin', 'admin')`
    const adminEmails = admins.recordset.map(a => a.email).join(',')

    // If ticket resolved — notify client and CC admins
    if (status === "Resolved" && ticket) {
      sendEmail(
        ticket.clientEmail,
        `Ticket ${ticket.ticketId} Resolved!! ✅`,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #16A34A;">Your Ticket has been Resolved!!</h1>
            <p>Great news — your support ticket has been resolved!!</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketId}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${ticket.title}</td></tr>
              <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Resolved By</strong></td><td style="padding: 8px;">${ticket.assignedTo}</td></tr>
            </table>
            <p>If you are still experiencing issues please raise a new ticket!!</p>
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )

      // CC admins on resolution
      if (adminEmails) {
        sendEmail(
          adminEmails,
          `[CC] Ticket ${ticket.ticketId} Resolved`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #16A34A;">Ticket Resolved</h1>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketId}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${ticket.title}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${ticket.clientEmail}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Resolved By</strong></td><td style="padding: 8px;">${ticket.assignedTo}</td></tr>
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