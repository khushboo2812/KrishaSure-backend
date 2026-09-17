const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')

const RESET_COOLDOWN_MS = 60 * 1000

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

    const result = await pool.query('SELECT * FROM People WHERE LOWER(email) = LOWER($1)', [email])

    if (result.rows.length === 0) {
      // Don't reveal if email exists or not (security best practice)
      return res.json({ message: 'If this email exists, a reset link has been sent.' })
    }

    const person = result.rows[0]

    // Without this, repeated requests for the same email each
    // immediately overwrite the temp password and re-email it — no
    // cooldown — so a caller could spam someone's inbox and keep
    // invalidating whatever temp password they were just sent before
    // they'd have a chance to use it. Same generic response either
    // way, so this can't be used to probe whether an email exists.
    if (person.lastpasswordresetrequestat) {
      const elapsed = Date.now() - new Date(person.lastpasswordresetrequestat).getTime()
      if (elapsed < RESET_COOLDOWN_MS) {
        return res.json({ message: 'If this email exists, a reset link has been sent.' })
      }
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    // One password per person across every membership — resetting it
    // here resets access for all of them, same as changing it any other way.
    await pool.query(
      'UPDATE People SET password = $1, mustChangePassword = true, lastPasswordResetRequestAt = NOW() WHERE id = $2',
      [hashedPassword, person.id]
    )

    sendEmail(
      email,
      'Password Reset - KrishaSure 🔐',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Password Reset Request</h1>
          <p>Hi ${person.name},</p>
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