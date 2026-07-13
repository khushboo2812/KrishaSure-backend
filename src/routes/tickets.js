const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')

// GET all tickets
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`SELECT * FROM Tickets ORDER BY createdAt DESC`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
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
    res.status(201).json({ message: 'Ticket created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT update ticket status
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { status, assignedTo, resolvedAt } = req.body
    await sql.query`
      UPDATE Tickets 
      SET status = ${status}, assignedTo = ${assignedTo}, resolvedAt = ${resolvedAt}
      WHERE id = ${id}
    `
    res.json({ message: 'Ticket updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})