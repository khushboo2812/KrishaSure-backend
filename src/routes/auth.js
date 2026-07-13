const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { sql } = require('../config/db')

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    const result = await sql.query`SELECT * FROM Users WHERE email = ${email}`
    
    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = result.recordset[0]

    const isMatch = await bcrypt.compare(password, user.password)
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'krishasure_secret',
      { expiresIn: '24h' }
    )

    res.json({
      token,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router