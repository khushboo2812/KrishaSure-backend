const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { sql } = require('../config/db')
const { sendEmail } = require('../config/email')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

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
    const { name, email, role, level, skills } = req.body

    const existing = await sql.query`SELECT id FROM Users WHERE email = ${email}`
    if (existing.recordset.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists!!' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)
    
    await sql.query`
      INSERT INTO Users (name, email, password, role)
      VALUES (${name}, ${email}, ${hashedPassword}, ${role})
    `

    // If agent add to Agents table
    if (role === 'agent') {
      await sql.query`
        INSERT INTO Agents (name, email, level, skills)
        VALUES (${name}, ${email}, ${level || 'Junior'}, ${skills || ''})
      `
    }

    sendEmail(
      email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${name},</p>
          <p>Your account has been created successfully!!</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>Please login and change your password immediately!!</p>
          <a href="http://localhost:5173" style="background: #00C2CB; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.status(201).json({ message: 'User created successfully!! Welcome email sent!!' })
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
      SET password = ${hashedPassword}, mustChangePassword = 0
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
    const userResult = await sql.query`SELECT * FROM Users WHERE id = ${id}`
    const user = userResult.recordset[0]
    
    if (user && user.role === 'agent') {
      await sql.query`DELETE FROM Agents WHERE email = ${user.email}`
    }
    
    await sql.query`DELETE FROM Users WHERE id = ${id}`
    res.json({ message: 'User deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router