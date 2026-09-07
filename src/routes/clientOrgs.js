const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM ClientOrganizations WHERE companyId = $1 ORDER BY name', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name } = req.body
    await pool.query(
      'INSERT INTO ClientOrganizations (name, companyId) VALUES ($1, $2)',
      [name, companyId]
    )
    res.status(201).json({ message: 'Client organization created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await pool.query('DELETE FROM ClientOrganizations WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'Client organization deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router