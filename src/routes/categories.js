const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM Categories WHERE companyId = $1 ORDER BY name', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, description } = req.body
    await pool.query(
      'INSERT INTO Categories (name, description, companyId) VALUES ($1, $2, $3)',
      [name, description, companyId]
    )
    res.status(201).json({ message: 'Category created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { name, description } = req.body
    await pool.query(
      'UPDATE Categories SET name = $1, description = $2 WHERE id = $3 AND companyId = $4',
      [name, description, id, companyId]
    )
    res.json({ message: 'Category updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await pool.query('DELETE FROM Categories WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'Category deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router