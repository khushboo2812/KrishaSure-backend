const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')

// GET all categories
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`SELECT * FROM Categories ORDER BY name`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create category
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body
    await sql.query`
      INSERT INTO Categories (name, description)
      VALUES (${name}, ${description})
    `
    res.status(201).json({ message: 'Category created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT update category
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, description } = req.body
    await sql.query`
      UPDATE Categories 
      SET name = ${name}, description = ${description}
      WHERE id = ${id}
    `
    res.json({ message: 'Category updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE category
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    await sql.query`DELETE FROM Categories WHERE id = ${id}`
    res.json({ message: 'Category deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router