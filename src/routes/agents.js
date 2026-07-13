const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')

// GET all agents
router.get('/', async (req, res) => {
  try {
    const result = await sql.query`SELECT * FROM Agents ORDER BY name`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router