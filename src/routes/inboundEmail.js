const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')

router.post('/', async (req, res) => {
  try {
    const payload = req.body
    console.log('Inbound email webhook received:', JSON.stringify(payload))

    // We'll fill in the actual ticket creation logic next
    res.status(200).json({ received: true })
  } catch (err) {
    console.error('Inbound email error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router