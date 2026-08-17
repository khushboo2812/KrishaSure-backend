const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await sql.query`
      SELECT s.*, c.name as categoryName 
      FROM SLARules s
      LEFT JOIN Categories c ON s.categoryId = c.id
      WHERE s.companyId = ${companyId}
      ORDER BY s.priority
    `
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { priority, categoryId, maxHours } = req.body
    await sql.query`
      INSERT INTO SLARules (priority, categoryId, maxHours, companyId)
      VALUES (${priority}, ${categoryId || null}, ${maxHours}, ${companyId})
    `
    res.status(201).json({ message: 'SLA rule created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { priority, categoryId, maxHours } = req.body
    await sql.query`
      UPDATE SLARules 
      SET priority = ${priority}, categoryId = ${categoryId || null}, maxHours = ${maxHours}
      WHERE id = ${id} AND companyId = ${companyId}
    `
    res.json({ message: 'SLA rule updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await sql.query`DELETE FROM SLARules WHERE id = ${id} AND companyId = ${companyId}`
    res.json({ message: 'SLA rule deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router