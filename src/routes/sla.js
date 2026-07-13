const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')

// GET all SLA rules
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`
      SELECT s.*, c.name as categoryName 
      FROM SLARules s
      LEFT JOIN Categories c ON s.categoryId = c.id
      ORDER BY s.priority
    `
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create SLA rule
router.post('/', async (req, res) => {
  try {
    const { priority, categoryId, maxHours } = req.body
    await sql.query`
      INSERT INTO SLARules (priority, categoryId, maxHours)
      VALUES (${priority}, ${categoryId || null}, ${maxHours})
    `
    res.status(201).json({ message: 'SLA rule created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT update SLA rule
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { priority, categoryId, maxHours } = req.body
    await sql.query`
      UPDATE SLARules 
      SET priority = ${priority}, categoryId = ${categoryId || null}, maxHours = ${maxHours}
      WHERE id = ${id}
    `
    res.json({ message: 'SLA rule updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE SLA rule
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    await sql.query`DELETE FROM SLARules WHERE id = ${id}`
    res.json({ message: 'SLA rule deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router