const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { sql } = require('../config/db')

router.get('/status', async (req, res) => {
  try {
    const result = await sql.query`SELECT COUNT(*) as count FROM Companies`
    const setupRequired = result.recordset[0].count === 0
    res.json({ setupRequired })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, companyName } = req.body

    // Create the company first
    const companyResult = await sql.query`
      INSERT INTO Companies (name, tier, databaseType)
      OUTPUT INSERTED.id
      VALUES (${companyName}, 'starter', 'shared')
    `
    const companyId = companyResult.recordset[0].id

    const hashedPassword = await bcrypt.hash(password, 10)

    await sql.query`
      INSERT INTO Users (name, email, password, role, mustChangePassword, companyId)
      VALUES (${name}, ${email}, ${hashedPassword}, 'superadmin', 0, ${companyId})
    `

    await sql.query`
      INSERT INTO Categories (name, description, companyId) VALUES
      ('Network', 'Network and connectivity issues', ${companyId}),
      ('Software', 'Software and application issues', ${companyId}),
      ('Hardware', 'Hardware and equipment issues', ${companyId}),
      ('Email', 'Email and communication issues', ${companyId})
    `

    await sql.query`
      INSERT INTO SLARules (priority, categoryId, maxHours, companyId) VALUES
      ('Urgent', NULL, 2, ${companyId}),
      ('High', NULL, 8, ${companyId}),
      ('Medium', NULL, 24, ${companyId}),
      ('Low', NULL, 72, ${companyId})
    `

    res.status(201).json({ message: 'Setup completed successfully!!', companyId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router