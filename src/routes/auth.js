const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../config/db')

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    const result = await pool.query('SELECT * FROM Users WHERE email = $1', [email])
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = result.rows[0]

    const isMatch = await bcrypt.compare(password, user.password)
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const companyResult = await pool.query('SELECT name FROM Companies WHERE id = $1', [user.companyid])
    const companyName = companyResult.rows[0]?.name || ''

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, companyId: user.companyid },
      process.env.JWT_SECRET || 'krishasure_secret',
      { expiresIn: '24h' }
    )

    res.json({
      token,
      mustChangePassword: user.mustchangepassword,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyid, companyName }
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router