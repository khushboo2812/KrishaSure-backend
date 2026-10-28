const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')
const { notifyNewComment } = require('../utils/commentNotifications')
const { resumeFromPending } = require('../utils/pendingTickets')
const { reopenEligibility, reopenTicket } = require('../utils/reopenTicket')
const { canAccessTicket, commentBelongsToCompany } = require('../utils/ticketAccess')

router.get('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
    if (!(await canAccessTicket(pool, ticketId, req.user))) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
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

    if (!(await canAccessTicket(pool, ticketId, req.user))) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    await pool.query(
      'INSERT INTO TicketComments (ticketId, authorName, authorEmail, comment) VALUES ($1, $2, $3, $4)',
      [ticketId, name, email, comment]
    )

    const ticketResult = await pool.query('SELECT * FROM Tickets WHERE id = $1', [ticketId])
    const ticket = ticketResult.rows[0]

    let resumed = false
    let reopened = false
    let reopenExpired = false
    if (ticket) {
      await notifyNewComment({ ticket, authorName: name, authorEmail: email, comment })
      // A client answering a ticket that's waiting on them puts it back
      // in the agent's queue.
      if (ticket.status === 'Pending' && req.user.role === 'client') {
        resumed = await resumeFromPending(ticket, { byName: name })
      }
      // A client commenting on a resolved ticket reopens it — same rule
      // as replying by email and as the Reopen button (within 2 weeks of
      // resolving). Past that the comment is kept but the ticket stays
      // closed, and the response says so for the screen to explain.
      if (ticket.status === 'Resolved' && req.user.role === 'client') {
        const eligibility = reopenEligibility(ticket)
        if (eligibility === 'ok') reopened = await reopenTicket(ticket, { byName: name })
        else if (eligibility === 'expired') reopenExpired = true
      }
    }

    res.status(201).json({ message: 'Comment added successfully!!', resumed, reopened, reopenExpired })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT edit comment
router.put('/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params
    const { comment } = req.body
    const { email, companyId } = req.user

    const existing = await pool.query('SELECT * FROM TicketComments WHERE id = $1', [commentId])
    if (existing.rows.length === 0 || !(await commentBelongsToCompany(pool, commentId, companyId))) {
      return res.status(404).json({ error: 'Comment not found' })
    }

    if (existing.rows[0].authoremail !== email) {
      return res.status(403).json({ error: 'You can only edit your own comments' })
    }

    await pool.query('UPDATE TicketComments SET comment = $1 WHERE id = $2', [comment, commentId])
    res.json({ message: 'Comment updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE comment
router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params
    const { email, companyId } = req.user

    const existing = await pool.query('SELECT * FROM TicketComments WHERE id = $1', [commentId])
    if (existing.rows.length === 0 || !(await commentBelongsToCompany(pool, commentId, companyId))) {
      return res.status(404).json({ error: 'Comment not found' })
    }

    if (existing.rows[0].authoremail !== email) {
      return res.status(403).json({ error: 'You can only delete your own comments' })
    }

    await pool.query('DELETE FROM TicketComments WHERE id = $1', [commentId])
    res.json({ message: 'Comment deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router