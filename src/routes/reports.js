const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')
const { parseWindow, buildTrendSeries } = require('../utils/reportTrends')

// platform_owner is included alongside superadmin/admin because
// PlatformDashboard's "View My Company" only fakes role: "superadmin"
// in localStorage — it never issues a new JWT, so req.user.role here is
// still the platform owner's real, unchanged role. No other route in
// this app checks role at all (only companyId), so that's always been
// enough for "View My Company" to work everywhere except here, where a
// role check is actually enforced.
function requireAdminOrSuperadmin(req, res, next) {
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin' && req.user.role !== 'platform_owner') {
    return res.status(403).json({ error: 'Access denied' })
  }
  next()
}

// GET per-agent performance for the company, within the date-range window.
// Superadmin/admin only — this is the comparative, cross-agent view.
router.get('/agent-performance', authenticateToken, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const { start } = parseWindow(req.query)

    // Resolved-ticket stats, open count (unwindowed — it's a live
    // snapshot), and SLA eligibility/breach counts, per agent. SLA
    // matching is priority-only (categoryId IS NULL rules), matching
    // the existing simplified SLA logic used elsewhere in this app —
    // category-specific SLA rules aren't applied anywhere yet.
    const perfResult = await pool.query(
      `SELECT
         a.id, a.name, a.email,
         COUNT(t.id) FILTER (WHERE t.status = 'Resolved' AND t.resolvedAt >= $2) AS resolvedcount,
         COUNT(t.id) FILTER (WHERE t.status != 'Resolved') AS opencount,
         AVG(EXTRACT(EPOCH FROM (t.resolvedAt - t.createdAt))) FILTER (WHERE t.status = 'Resolved' AND t.resolvedAt >= $2) AS avgresolutionseconds,
         COUNT(t.id) FILTER (WHERE t.status = 'Resolved' AND t.resolvedAt >= $2 AND sla.maxHours IS NOT NULL) AS slaeligiblecount,
         COUNT(t.id) FILTER (WHERE t.status = 'Resolved' AND t.resolvedAt >= $2 AND sla.maxHours IS NOT NULL AND EXTRACT(EPOCH FROM (t.resolvedAt - t.createdAt)) / 3600 > sla.maxHours) AS breachedcount
       FROM Agents a
       LEFT JOIN Tickets t ON t.assignedTo = a.name AND t.companyId = a.companyId
       LEFT JOIN SLARules sla ON sla.priority = t.priority AND sla.categoryId IS NULL AND sla.companyId = a.companyId
       WHERE a.companyId = $1
       GROUP BY a.id, a.name, a.email
       ORDER BY a.name`,
      [companyId, start]
    )

    // Hours logged is computed separately (not joined into the query
    // above) to avoid a join fan-out between Tickets and HoursLog
    // double-counting rows.
    const hoursResult = await pool.query(
      `SELECT h.loggedBy, COALESCE(SUM(h.hoursSpent), 0) AS totalhours
       FROM HoursLog h
       JOIN Tickets t ON h.ticketId = t.id
       WHERE t.companyId = $1 AND h.loggedAt >= $2
       GROUP BY h.loggedBy`,
      [companyId, start]
    )
    const hoursByEmail = {}
    hoursResult.rows.forEach(r => { hoursByEmail[r.loggedby] = parseFloat(r.totalhours) })

    const agents = perfResult.rows.map(r => {
      const eligible = parseInt(r.slaeligiblecount)
      const breached = parseInt(r.breachedcount)
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        resolvedCount: parseInt(r.resolvedcount),
        openCount: parseInt(r.opencount),
        avgResolutionHours: r.avgresolutionseconds !== null ? parseFloat(r.avgresolutionseconds) / 3600 : null,
        slaBreachRate: eligible > 0 ? (breached / eligible) * 100 : null,
        hoursLogged: hoursByEmail[r.email] || 0
      }
    })

    res.json(agents)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET the requesting user's own performance numbers, within the same
// date-range window. Any authenticated role — identity comes from the
// token, never a param, so there's no way to query someone else's
// numbers through this route.
router.get('/my-performance', authenticateToken, async (req, res) => {
  try {
    const { companyId, name, email } = req.user
    const { start } = parseWindow(req.query)

    const ticketResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'Resolved' AND resolvedAt >= $3) AS resolvedcount,
         COUNT(*) FILTER (WHERE status != 'Resolved') AS opencount,
         AVG(EXTRACT(EPOCH FROM (resolvedAt - createdAt))) FILTER (WHERE status = 'Resolved' AND resolvedAt >= $3) AS avgresolutionseconds
       FROM Tickets
       WHERE companyId = $1 AND assignedTo = $2`,
      [companyId, name, start]
    )

    const hoursResult = await pool.query(
      `SELECT COALESCE(SUM(h.hoursSpent), 0) AS totalhours
       FROM HoursLog h
       JOIN Tickets t ON h.ticketId = t.id
       WHERE t.companyId = $1 AND h.loggedBy = $2 AND h.loggedAt >= $3`,
      [companyId, email, start]
    )

    const row = ticketResult.rows[0]
    res.json({
      resolvedCount: parseInt(row.resolvedcount),
      openCount: parseInt(row.opencount),
      avgResolutionHours: row.avgresolutionseconds !== null ? parseFloat(row.avgresolutionseconds) / 3600 : null,
      hoursLogged: parseFloat(hoursResult.rows[0].totalhours)
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET ticket volume (created vs resolved) and SLA compliance %,
// time-bucketed over the date-range window. Superadmin/admin only.
router.get('/ticket-trends', authenticateToken, requireAdminOrSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const { bucket, now, start } = parseWindow(req.query)

    // The full list of buckets in the window (zero-filled via
    // generate_series) so the chart has no gaps on quiet days.
    const bucketsResult = await pool.query(
      `SELECT generate_series(date_trunc($1, $2::timestamptz), date_trunc($1, $3::timestamptz), ('1 ' || $1)::interval) AS bucket`,
      [bucket, start, now]
    )

    const createdResult = await pool.query(
      `SELECT date_trunc($1, createdAt) AS bucket, COUNT(*) AS cnt
       FROM Tickets WHERE companyId = $2 AND createdAt >= $3
       GROUP BY 1`,
      [bucket, companyId, start]
    )

    // Compliance is priority-only (categoryId IS NULL SLA rules),
    // matching the existing simplified SLA logic elsewhere in this app.
    const resolvedResult = await pool.query(
      `SELECT date_trunc($1, t.resolvedAt) AS bucket,
         COUNT(*) AS resolvedcnt,
         COUNT(*) FILTER (WHERE sla.maxHours IS NOT NULL) AS eligiblecnt,
         COUNT(*) FILTER (WHERE sla.maxHours IS NOT NULL AND EXTRACT(EPOCH FROM (t.resolvedAt - t.createdAt)) / 3600 <= sla.maxHours) AS withinslacnt
       FROM Tickets t
       LEFT JOIN SLARules sla ON sla.priority = t.priority AND sla.categoryId IS NULL AND sla.companyId = t.companyId
       WHERE t.companyId = $2 AND t.status = 'Resolved' AND t.resolvedAt >= $3
       GROUP BY 1`,
      [bucket, companyId, start]
    )

    res.json(buildTrendSeries(bucketsResult.rows, createdResult.rows, resolvedResult.rows))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
