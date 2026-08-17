const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await sql.query`SELECT * FROM Categories WHERE companyId = ${companyId} ORDER BY name`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, description } = req.body
    await sql.query`
      INSERT INTO Categories (name, description, companyId)
      VALUES (${name}, ${description}, ${companyId})
    `
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
    await sql.query`
      UPDATE Categories 
      SET name = ${name}, description = ${description}
      WHERE id = ${id} AND companyId = ${companyId}
    `
    res.json({ message: 'Category updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await sql.query`DELETE FROM Categories WHERE id = ${id} AND companyId = ${companyId}`
    res.json({ message: 'Category deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router