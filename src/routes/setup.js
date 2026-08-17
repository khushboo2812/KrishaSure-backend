const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')

router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM Companies')
    const setupRequired = parseInt(result.rows[0].count) === 0
    res.json({ setupRequired })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, companyName } = req.body

    const companyResult = await pool.query(
      'INSERT INTO Companies (name, tier, databaseType) VALUES ($1, $2, $3) RETURNING id',
      [companyName, 'starter', 'shared']
    )
    const companyId = companyResult.rows[0].id

    const hashedPassword = await bcrypt.hash(password, 10)

    await pool.query(
      'INSERT INTO Users (name, email, password, role, mustChangePassword, companyId) VALUES ($1, $2, $3, $4, $5, $6)',
      [name, email, hashedPassword, 'superadmin', false, companyId]
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

    res.status(201).json({ message: 'Setup completed successfully!!', companyId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router