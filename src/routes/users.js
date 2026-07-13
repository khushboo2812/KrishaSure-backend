const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { sql } = require('../config/db')

// GET all users
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`SELECT id, name, email, role, createdAt FROM Users`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create user
router.post('/', async (req, res) => {
  try {
    const { name, email, role } = req.body
    const tempPassword = "Welcome@123"
    const hashedPassword = await bcrypt.hash(tempPassword, 10)
    
    await sql.query`
      INSERT INTO Users (name, email, password, role)
      VALUES (${name}, ${email}, ${hashedPassword}, ${role})
    `
    res.status(201).json({ 
      message: 'User created successfully!!',
      tempPassword: tempPassword
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT reset password
router.put('/:id/password', async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body
    const hashedPassword = await bcrypt.hash(password, 10)
    
    await sql.query`
      UPDATE Users 
      SET password = ${hashedPassword}
      WHERE id = ${id}
    `
    res.json({ message: 'Password updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    await sql.query`DELETE FROM Users WHERE id = ${id}`
    res.json({ message: 'User deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router