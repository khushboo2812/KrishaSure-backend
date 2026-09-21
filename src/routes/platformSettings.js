const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requirePlatformOwner } = require('../middleware/auth')

// GET the single global usage-limit enforcement toggle — see
// sql/add_usage_limits.sql and src/utils/usageLimits.js.
// PlatformSettings is always exactly one row (id=1).
router.get('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const result = await pool.query('SELECT enforceUsageLimits FROM PlatformSettings WHERE id = 1')
    res.json({ enforceUsageLimits: result.rows[0]?.enforceusagelimits ?? false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT flips it — platform-wide, takes effect for every company
// immediately. Each company's own maxUsers/aiEnabled/
// maxAiRequestsPerMonth (see PUT /api/companies/:id/plan-limits) stay
// completely inert until this is true, so setting a company's limits
// ahead of turning this on is safe and has no effect yet.
router.put('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { enforceUsageLimits } = req.body
    await pool.query('UPDATE PlatformSettings SET enforceUsageLimits = $1 WHERE id = 1', [!!enforceUsageLimits])
    res.json({ enforceUsageLimits: !!enforceUsageLimits })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
