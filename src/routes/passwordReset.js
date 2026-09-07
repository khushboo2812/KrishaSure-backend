const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

// Request password reset
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body

    const result = await pool.query('SELECT * FROM Users WHERE email = $1', [email])
    
    if (result.rows.length === 0) {
      // Don't reveal if email exists or not (security best practice)
      return res.json({ message: 'If this email exists, a reset link has been sent.' })
    }

    const user = result.rows[0]
    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, user.id]
    )

    sendEmail(
      email,
      'Password Reset - KrishaSure 🔐',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Password Reset Request</h1>
          <p>Hi ${user.name},</p>
          <p>We received a request to reset your password.</p>
          <p><strong>Your new temporary password:</strong> ${tempPassword}</p>
          <p>Please login and change this password immediately!!</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">If you didn't request this, please contact support immediately.</p>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.json({ message: 'If this email exists, a reset link has been sent.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router