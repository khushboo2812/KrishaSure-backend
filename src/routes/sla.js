const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query(
      `SELECT s.*, c.name as categoryName 
       FROM SLARules s
       LEFT JOIN Categories c ON s.categoryId = c.id
       WHERE s.companyId = $1
       ORDER BY s.priority`,
      [companyId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { priority, categoryId, maxHours } = req.body
    await pool.query(
      'INSERT INTO SLARules (priority, categoryId, maxHours, companyId) VALUES ($1, $2, $3, $4)',
      [priority, categoryId || null, maxHours, companyId]
    )
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
    await pool.query(
      'UPDATE SLARules SET priority = $1, categoryId = $2, maxHours = $3 WHERE id = $4 AND companyId = $5',
      [priority, categoryId || null, maxHours, id, companyId]
    )
    res.json({ message: 'SLA rule updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await pool.query('DELETE FROM SLARules WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'SLA rule deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router