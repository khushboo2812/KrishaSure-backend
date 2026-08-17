const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT id, name, email, role, createdAt FROM Users WHERE companyId = $1', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, email, role, level, skills } = req.body

    const existing = await pool.query('SELECT id FROM Users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists!!' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)
    
    await pool.query(
      'INSERT INTO Users (name, email, password, role, companyId) VALUES ($1, $2, $3, $4, $5)',
      [name, email, hashedPassword, role, companyId]
    )

    if (role === 'agent') {
      await pool.query(
        'INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)',
        [name, email, level || 'Junior', skills || '', companyId]
      )
    }

    sendEmail(
      email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${name},</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
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

router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body
    const hashedPassword = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = false WHERE id = $2',
      [hashedPassword, id]
    )
    res.json({ message: 'Password updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/resend-welcome', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, id]
    )

    sendEmail(
      user.email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${user.name},</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.json({ message: 'Welcome email resent successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]
    
    if (user && user.role === 'agent') {
      await pool.query('DELETE FROM Agents WHERE email = $1 AND companyId = $2', [user.email, companyId])
    }
    
    await pool.query('DELETE FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'User deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router