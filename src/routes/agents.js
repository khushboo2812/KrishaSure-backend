const express = require('express')
const router = express.Router()
const { sql } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await sql.query`SELECT * FROM Agents WHERE companyId = ${companyId} ORDER BY name`
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router