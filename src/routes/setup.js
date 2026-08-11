const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { sql } = require('../config/db')

// Check if setup is needed
router.get('/status', async (req, res) => {
  try {
    const result = await sql.query`SELECT COUNT(*) as count FROM Users`
    const setupRequired = result.recordset[0].count === 0
    res.json({ setupRequired })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create first Super Admin
router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, companyName } = req.body

    // Safety check - only allow if no users exist
    const check = await sql.query`SELECT COUNT(*) as count FROM Users`
    if (check.recordset[0].count > 0) {
      return res.status(403).json({ error: 'Setup already completed. Cannot create another initial admin.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await sql.query`
      INSERT INTO Users (name, email, password, role, mustChangePassword)
      VALUES (${name}, ${email}, ${hashedPassword}, 'superadmin', 0)
    `

    // Create default categories
    await sql.query`
      INSERT INTO Categories (name, description) VALUES
      ('Network', 'Network and connectivity issues'),
      ('Software', 'Software and application issues'),
      ('Hardware', 'Hardware and equipment issues'),
      ('Email', 'Email and communication issues')
    `

    // Create default SLA rules
    await sql.query`
      INSERT INTO SLARules (priority, categoryId, maxHours) VALUES
      ('Urgent', NULL, 2),
      ('High', NULL, 8),
      ('Medium', NULL, 24),
      ('Low', NULL, 72)
    `

    res.status(201).json({ message: 'Setup completed successfully!!', companyName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router