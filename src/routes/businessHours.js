const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireAdminOrSuperadmin } = require('../middleware/auth')

const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

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
    const { businessDays, businessHoursStart, businessHoursEnd, timezone } = req.body

    const days = (businessDays || '').split(',').map(d => d.trim()).filter(Boolean)
    if (days.length === 0 || !days.every(d => VALID_DAYS.has(d))) {
      return res.status(400).json({ error: 'businessDays must be a comma-separated list of Mon/Tue/Wed/Thu/Fri/Sat/Sun' })
    }
    if (!TIME_RE.test(businessHoursStart) || !TIME_RE.test(businessHoursEnd)) {
      return res.status(400).json({ error: 'businessHoursStart/End must be in HH:MM 24-hour format' })
    }
    if (toMinutes(businessHoursStart) >= toMinutes(businessHoursEnd)) {
      return res.status(400).json({ error: 'businessHoursStart must be earlier than businessHoursEnd' })
    }
    if (!timezone || !isValidTimezone(timezone)) {
      return res.status(400).json({ error: 'timezone must be a valid IANA timezone name (e.g. America/New_York)' })
    }

    await pool.query(
      'UPDATE Companies SET businessDays = $1, businessHoursStart = $2, businessHoursEnd = $3, timezone = $4 WHERE id = $5',
      [days.join(','), businessHoursStart, businessHoursEnd, timezone, companyId]
    )
    res.json({ message: 'Business hours updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
