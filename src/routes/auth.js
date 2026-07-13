const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { sql } = require('../config/db')

// POST login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    // Find user
    const result = await sql.query`SELECT * FROM Users WHERE email = ${email}`
    
    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = result.recordset[0]

    // For now compare plain text (we'll hash later)
    if (password !== user.password) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'krishasure_secret',
      { expiresIn: '24h' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router