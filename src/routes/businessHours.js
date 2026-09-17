const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireAdminOrSuperadmin } = require('../middleware/auth')
const { validateBusinessHoursInput } = require('../utils/validateBusinessHours')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query(
      'SELECT businessDays, businessHoursStart, businessHoursEnd, timezone FROM Companies WHERE id = $1',
      [companyId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' })
    }
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Self-service — any company's own superadmin/admin sets their own
// hours, not platform-owner-gated like companies.js. Applies uniformly
// to every company (internal and MSP alike); this is a per-company
// setting, not per-client-org.
router.put('/', authenticateToken, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const validated = validateBusinessHoursInput(req.body)
    if (validated.error) {
      return res.status(400).json({ error: validated.error })
    }

    await pool.query(
      'UPDATE Companies SET businessDays = $1, businessHoursStart = $2, businessHoursEnd = $3, timezone = $4 WHERE id = $5',
      [validated.businessDays, validated.businessHoursStart, validated.businessHoursEnd, validated.timezone, companyId]
    )
    res.json({ message: 'Business hours updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
