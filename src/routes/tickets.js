const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken, requireNotClient } = require('../middleware/auth')
const { generateTicketId } = require('../utils/ticketId')
const { getTicketReplyFromAddress } = require('../utils/supportEmail')
const { PRIORITIES } = require('../utils/classifyTicket')

// Tickets only stores clientEmail (a ticket can come in from someone
// with no People row at all, historically, or a typo'd address), so
// the requester's name is resolved live via a LEFT JOIN rather than
// stored on the ticket — this also means a rename in People shows up
// immediately on old tickets instead of freezing whatever name existed
// at creation time. clientName is null when no matching person exists;
// callers fall back to showing the raw email.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query(
      `SELECT t.*, p.name AS clientName
       FROM Tickets t
       LEFT JOIN People p ON LOWER(p.email) = LOWER(t.clientEmail)
       WHERE t.companyId = $1
       ORDER BY t.createdAt DESC`,
      [companyId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const result = await pool.query(
      `SELECT t.*, p.name AS clientName
       FROM Tickets t
       LEFT JOIN People p ON LOWER(p.email) = LOWER(t.clientEmail)
       WHERE t.id = $1 AND t.companyId = $2`,
      [id, companyId]
    )
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
    const { title, description, category, priority, assignedTo, clientEmail, clientOrgId, aiConversation } = req.body

    const ticketId = await generateTicketId(pool)
const initialStatus = assignedTo ? 'Open/Assigned' : 'Open/Unassigned'

// aiConversation is [{role: 'user'|'model', text}], text only (see
// sql/add_ticket_ai_conversation.sql) — whatever the client discussed
// with the AI suggestion feature before submitting, if anything, so
// whoever picks up the ticket isn't starting from zero. Stored as-is;
// an empty/absent conversation is just null, nothing to validate.
const insertResult = await pool.query(
  'INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId, status, aiConversation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
  [ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId || null, initialStatus, aiConversation && aiConversation.length > 0 ? JSON.stringify(aiConversation) : null]
)
const newTicketDbId = insertResult.rows[0].id

    const admins = await pool.query("SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    const agentResult = await pool.query('SELECT email FROM Agents WHERE name = $1 AND companyId = $2', [assignedTo, companyId])
const agentEmail = agentResult.rows[0]?.email

    const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId, clientOrgId })

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
          <p style="color: #64748B; font-size: 12px;">⏱️ Response/resolution timers only count business hours — time outside the support team's working hours doesn't count against your SLA.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      adminEmails,
      replyFromAddress
    )

    if (agentEmail) {
      const hadAiConversation = aiConversation && aiConversation.length > 0
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
            ${hadAiConversation ? '<p style="color: #7C3AED; font-size: 13px; font-weight: 600;">✨ This client already spoke with the AI assistant before filing this ticket and didn\'t get a fix — that conversation is saved on the ticket for you to review.</p>' : ''}
            <br/>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `,
        adminEmails,
        replyFromAddress
      )
    }

    res.status(201).json({ message: 'Ticket created successfully!!', ticketId, id: newTicketDbId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', authenticateToken, requireNotClient, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId, email, name } = req.user
    const { status, assignedTo, resolvedAt, hoursSpent } = req.body

    const ticketResult = await pool.query('SELECT * FROM Tickets WHERE id = $1 AND companyId = $2', [id, companyId])
    const ticket = ticketResult.rows[0]

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    await pool.query(
      'UPDATE Tickets SET status = $1, assignedTo = $2, resolvedAt = $3 WHERE id = $4 AND companyId = $5',
      [status, assignedTo, resolvedAt, id, companyId]
    )

    if (status === "Resolved" && hoursSpent) {
      await pool.query(
        'INSERT INTO HoursLog (ticketId, hoursSpent, loggedBy) VALUES ($1, $2, $3)',
        [id, hoursSpent, email]
      )
    }

    // Only 'Reopened' was ever logged here (see POST /:id/reopen below)
    // — logging 'Resolved' too means the full created -> resolved ->
    // reopened -> resolved... sequence is preserved permanently, even
    // though reopenedAt (below) only tracks the most recent round for
    // the live timers/SLA math.
    if (status === "Resolved" && ticket.status !== "Resolved") {
      await pool.query(
        'INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)',
        [id, 'Resolved', name]
      )
    }

    const admins = await pool.query("SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    const replyFromAddress = ticket ? await getTicketReplyFromAddress(pool, { companyId, clientOrgId: ticket.clientorgid }) : null

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
        `,
        adminEmails,
        replyFromAddress
      )
    }

    // A ticket reassigned to a different agent (not the create-time
    // assignment, which POST / already notifies about, and not a resolve
    // — resolving always resends the ticket's current, unchanged
    // assignedTo) never told the newly assigned agent anything landed on
    // their desk.
    if (ticket && assignedTo && assignedTo !== ticket.assignedto) {
      const agentResult = await pool.query('SELECT email FROM Agents WHERE name = $1 AND companyId = $2', [assignedTo, companyId])
      const agentEmail = agentResult.rows[0]?.email
      if (agentEmail) {
        sendEmail(
          agentEmail,
          `Ticket Assigned to You - ${ticket.ticketid}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #0A2540;">A Ticket Has Been Assigned to You</h1>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticket.ticketid}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Title</strong></td><td style="padding: 8px;">${ticket.title}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${ticket.clientemail}</td></tr>
              </table>
              <br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `,
          adminEmails,
          replyFromAddress
        )
      }
    }

    res.json({ message: 'Ticket updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Separate from PUT /:id on purpose: that route overwrites status,
// assignedTo and resolvedAt together from whatever the body carries, so
// adding category/priority there would force every existing caller to
// send them too or have them nulled. Marks the result 'manual' so the
// "set by AI" hint disappears once a person has confirmed or fixed it.
router.put('/:id/classification', authenticateToken, requireNotClient, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId, name } = req.user
    const { category, priority } = req.body

    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Priority must be one of: ${PRIORITIES.join(', ')}` })
    }

    const categoryResult = await pool.query('SELECT 1 FROM Categories WHERE companyId = $1 AND name = $2', [companyId, category])
    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ error: 'That category no longer exists — refresh and pick another.' })
    }

    const ticketResult = await pool.query('SELECT category, priority FROM Tickets WHERE id = $1 AND companyId = $2', [id, companyId])
    const ticket = ticketResult.rows[0]
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    await pool.query(
      "UPDATE Tickets SET category = $1, priority = $2, categorySource = 'manual' WHERE id = $3 AND companyId = $4",
      [category, priority, id, companyId]
    )

    if (ticket.category !== category || ticket.priority !== priority) {
      await pool.query(
        'INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)',
        [id, 'Recategorized', name]
      )
    }

    res.json({ message: 'Category and priority updated!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST reopen ticket
router.post('/:id/reopen', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { name } = req.user

    const ticketResult = await pool.query('SELECT * FROM Tickets WHERE id = $1 AND companyId = $2', [id, companyId])
    const ticket = ticketResult.rows[0]

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    if (ticket.status !== 'Resolved') {
      return res.status(400).json({ error: 'Only resolved tickets can be reopened' })
    }

    // Check if within 2 weeks
    const resolvedDate = new Date(ticket.resolvedat)
    const now = new Date()
    const daysSinceResolved = (now - resolvedDate) / (1000 * 60 * 60 * 24)

    if (daysSinceResolved > 14) {
      return res.status(400).json({ error: 'This ticket cannot be reopened as it was resolved more than 2 weeks ago. Please create a new ticket.' })
    }

    // Reopen: keep same agent, change status back. reopenedAt marks the
    // start of this new round — the live "open for"/SLA math (see
    // reports.js's getTimerStart) uses it instead of the ticket's
    // original createdAt, so a ticket that already used up its SLA
    // window before its first resolution doesn't read as instantly
    // breached again the moment it's reopened. createdAt itself is
    // left untouched — ticket age and sort order elsewhere still
    // reflect when it was actually first filed.
    await pool.query(
      "UPDATE Tickets SET status = 'Open/Assigned', reopenedAt = NOW() WHERE id = $1",
      [id]
    )

    // Log the action
    await pool.query(
      'INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)',
      [id, 'Reopened', name]
    )

    // Notify everyone
    const admins = await pool.query("SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1", [companyId])
    const adminEmails = admins.rows.map(a => a.email).join(',')

    const agentResult = await pool.query(
      `SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE p.name = $1 AND m.companyId = $2`,
      [ticket.assignedto, companyId]
    )
    const agentEmail = agentResult.rows[0]?.email
    const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId, clientOrgId: ticket.clientorgid })

    sendEmail(
      ticket.clientemail,
      `Ticket ${ticket.ticketid} Reopened`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #F59E0B;">Ticket Reopened</h1>
          <p>Ticket <strong>${ticket.ticketid}</strong> has been reopened by ${name}.</p>
          <p>It has been reassigned to <strong>${ticket.assignedto}</strong> for follow up.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      agentEmail ? `${agentEmail},${adminEmails}` : adminEmails,
      replyFromAddress
    )

    res.json({ message: 'Ticket reopened successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router