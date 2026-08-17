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

function requirePlatformOwner(req, res, next) {
  if (req.user.role !== 'platform_owner') {
    return res.status(403).json({ error: 'Access denied' })
  }
  next()
}

// GET all companies
router.get('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Companies ORDER BY createdAt DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create new company + their superadmin
router.post('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { companyName, adminName, adminEmail, tier } = req.body

    const existing = await pool.query('SELECT id FROM Users WHERE email = $1', [adminEmail])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists!!' })
    }

    const companyResult = await pool.query(
      'INSERT INTO Companies (name, tier, databaseType) VALUES ($1, $2, $3) RETURNING id',
      [companyName, tier || 'starter', 'shared']
    )
    const companyId = companyResult.rows[0].id

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'INSERT INTO Users (name, email, password, role, mustChangePassword, companyId) VALUES ($1, $2, $3, $4, $5, $6)',
      [adminName, adminEmail, hashedPassword, 'superadmin', true, companyId]
    )

    await pool.query(
      `INSERT INTO Categories (name, description, companyId) VALUES 
       ($1, $2, $3), ($4, $5, $3), ($6, $7, $3), ($8, $9, $3)`,
      ['Network', 'Network and connectivity issues', companyId, 
       'Software', 'Software and application issues',
       'Hardware', 'Hardware and equipment issues',
       'Email', 'Email and communication issues']
    )

    await pool.query(
      `INSERT INTO SLARules (priority, categoryId, maxHours, companyId) VALUES 
       ($1, NULL, $2, $3), ($4, NULL, $5, $3), ($6, NULL, $7, $3), ($8, NULL, $9, $3)`,
      ['Urgent', 2, companyId, 'High', 8, 'Medium', 24, 'Low', 72]
    )

    sendEmail(
      adminEmail,
      `Welcome to KrishaSure - ${companyName}!! 🎉`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${adminName},</p>
          <p>Your company account for <strong>${companyName}</strong> has been created!!</p>
          <p><strong>Email:</strong> ${adminEmail}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>Please login and change your password immediately!!</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.status(201).json({ message: 'Company created successfully!! Welcome email sent!!', companyId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST resend welcome email for a company's admin
router.post('/:id/resend-welcome', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { id } = req.params

    const companyResult = await pool.query('SELECT * FROM Companies WHERE id = $1', [id])
    const company = companyResult.rows[0]

    const adminResult = await pool.query(
      "SELECT * FROM Users WHERE companyId = $1 AND role = 'superadmin'",
      [id]
    )
    const admin = adminResult.rows[0]

    if (!admin) {
      return res.status(404).json({ error: 'Company admin not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, admin.id]
    )

    sendEmail(
      admin.email,
      `Welcome to KrishaSure - ${company.name}!! 🎉`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${admin.name},</p>
          <p><strong>Email:</strong> ${admin.email}</p>
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

module.exports = router