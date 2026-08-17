const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')

// Setup is now disabled - platform owner creates companies via /api/companies
router.get('/status', async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) as count FROM Users WHERE role = 'platform_owner'")
    const setupRequired = parseInt(result.rows[0].count) === 0
    res.json({ setupRequired })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router