const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

// GET comments for a ticket
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

// POST add comment
router.post('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
    const { comment } = req.body
    const { name, email } = req.user

    await pool.query(
      'INSERT INTO TicketComments (ticketId, authorName, authorEmail, comment) VALUES ($1, $2, $3, $4)',
      [ticketId, name, email, comment]
    )

    res.status(201).json({ message: 'Comment added successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router