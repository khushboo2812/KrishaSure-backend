const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    // Suppliers are outsiders and can't assign tickets, so they get no
    // list of the company's staff.
    if (req.user.role === 'supplier') return res.json([])
    // isActive comes from this agent's Membership (via People), not the
    // Agents row itself — exposed as data rather than filtered out here,
    // since this list is also used for management/display, not just
    // picking who a new ticket can go to. Callers doing assignment
    // (auto-assign, the manual assign dropdown) are the ones that
    // should exclude inactive agents.
    const result = await pool.query(
      `SELECT a.*, m.isActive, m.role AS membershipRole
       FROM Agents a
       JOIN People p ON p.email = a.email
       JOIN Memberships m ON m.personId = p.id AND m.companyId = a.companyId
       WHERE a.companyId = $1
       ORDER BY a.name`,
      [companyId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router