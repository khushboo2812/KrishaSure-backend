const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireSuperadmin } = require('../middleware/auth')
const { parseWindow, buildTrendSeries } = require('../utils/reportTrends')
const { activeBusinessHours, getEffectiveBusinessHours } = require('../utils/businessHours')

async function getCompanyBusinessHours(companyId) {
  const result = await pool.query(
    'SELECT businessDays, businessHoursStart, businessHoursEnd, timezone FROM Companies WHERE id = $1',
    [companyId]
  )
  const row = result.rows[0]
  return row && {
    businessDays: row.businessdays,
    businessHoursStart: row.businesshoursstart,
    businessHoursEnd: row.businesshoursend,
    timezone: row.timezone
  }
}

// A client org can optionally override its company's business hours
// (see getEffectiveBusinessHours) — keyed by clientOrgId so a
// per-ticket lookup during SLA classification is a plain object read.
async function getClientOrgBusinessHoursById(companyId) {
  const result = await pool.query(
    'SELECT id, businessDays, businessHoursStart, businessHoursEnd, timezone FROM ClientOrganizations WHERE companyId = $1',
    [companyId]
  )
  const byId = {}
  result.rows.forEach(r => {
    byId[r.id] = { businessDays: r.businessdays, businessHoursStart: r.businesshoursstart, businessHoursEnd: r.businesshoursend, timezone: r.timezone }
  })
  return byId
}

// SLARules.categoryId is a Categories.id FK, but Tickets only stores
// the category's name (see tickets.js) — this bridges the two so a
// per-ticket SLA lookup can match a category-scoped rule at all.
async function getCategoryNameToId(companyId) {
  const result = await pool.query('SELECT id, name FROM Categories WHERE companyId = $1', [companyId])
  const byName = {}
  result.rows.forEach(r => { byName[r.name] = r.id })
  return byName
}

// Six-tier waterfall, most specific wins, for the same priority. A
// ticket is either tied to one client org or is "internal"
// (clientOrgId NULL — the MSP's own tickets, not filed on behalf of a
// client), never both, so only one of tiers 1-2 or 3-4 ever applies to
// a given ticket:
// 1. this client org + this category
// 2. this client org, any category
// 3. internal-only + this category (a ticket with no client org)
// 4. internal-only, any category
// 5. this category, any client org/internal (the original category override)
// 6. company-wide default (nothing set)
// Tier 5-6 rules (clientOrgId NULL, internalOnly false) still apply to
// both client-org tickets without their own override AND internal
// tickets without their own internalOnly override — internalOnly only
// carves out a tier ABOVE that shared fallback, it doesn't remove
// internal tickets from it. A found rule with maxHours NULL means "no
// SLA limit" for whatever it matched — deliberately, not the same as
// "no rule configured" (which still falls through to a less specific
// tier).
//
// idsMatch, not ===: Tickets.clientOrgId is int4 (pg driver hands back
// a JS number), but SLARules.clientOrgId is bigint (pg driver hands
// back a string, to avoid precision loss) — same actual id, different
// JS type, so a straight === silently never matched and every
// client-org-specific rule fell through to the company-wide default
// instead. Confirmed live: ticket KS-024's clientOrgId (integer 3)
// against SLARules.clientOrgId (bigint "3") — pg_typeof showed
// "integer" vs "bigint" for what's numerically the same id.
function idsMatch(a, b) {
  return a != null && b != null && Number(a) === Number(b)
}

function resolveSlaRule(ticket, slaRules, categoryNameToId) {
  const categoryId = categoryNameToId?.[ticket.category]
  const clientOrgId = ticket.clientorgid
  const isInternal = clientOrgId == null

  if (clientOrgId != null && categoryId !== undefined) {
    const rule = slaRules.find(r => r.priority === ticket.priority && idsMatch(r.clientorgid, clientOrgId) && idsMatch(r.categoryid, categoryId))
    if (rule) return rule
  }
  if (clientOrgId != null) {
    const rule = slaRules.find(r => r.priority === ticket.priority && idsMatch(r.clientorgid, clientOrgId) && r.categoryid === null)
    if (rule) return rule
  }
  if (isInternal && categoryId !== undefined) {
    const rule = slaRules.find(r => r.priority === ticket.priority && r.internalonly === true && idsMatch(r.categoryid, categoryId))
    if (rule) return rule
  }
  if (isInternal) {
    const rule = slaRules.find(r => r.priority === ticket.priority && r.internalonly === true && r.categoryid === null)
    if (rule) return rule
  }
  if (categoryId !== undefined) {
    const rule = slaRules.find(r => r.priority === ticket.priority && r.clientorgid == null && r.internalonly === false && idsMatch(r.categoryid, categoryId))
    if (rule) return rule
  }
  return slaRules.find(r => r.priority === ticket.priority && r.categoryid === null && r.clientorgid == null && r.internalonly === false) || null
}

// A reopened ticket's current round is measured from when it was
// reopened, not its original creation — otherwise every SLA/resolution-
// time number for that round would be inflated by however long it sat
// resolved in between, and would already read as "breached" the moment
// it's reopened if the first round had used up the SLA window. The
// original createdAt is left untouched everywhere else (ticket age,
// sort order, audit trail) — this only affects which timestamp counts
// as the start of the *current* open/resolved round.
function getTimerStart(ticket) {
  return ticket.reopenedat || ticket.createdat
}

// SLA eligibility/breach can't be a SQL EXTRACT(EPOCH ...) comparison
// once "hours elapsed" means business hours, not wall-clock — there's
// no portable way to run this app's Intl-based, DST-correct business-
// hours algorithm inside Postgres. Classified in JS instead, per
// ticket, against the effective hours for that ticket's client org
// (its own override if it has one, otherwise the company's).
function isSlaEligible(ticket, slaRules, categoryNameToId) {
  const rule = resolveSlaRule(ticket, slaRules, categoryNameToId)
  return !!(rule && rule.maxhours !== null)
}
function isWithinSla(ticket, slaRules, companyBusinessHours, clientOrgBusinessHoursById, categoryNameToId) {
  const rule = resolveSlaRule(ticket, slaRules, categoryNameToId)
  if (!rule || rule.maxhours === null) return null
  const effective = getEffectiveBusinessHours(companyBusinessHours, clientOrgBusinessHoursById?.[ticket.clientorgid])
  return activeBusinessHours(ticket, ticket.resolvedat, effective) <= rule.maxhours
}

// GET per-agent performance for the company, within the date-range window.
// Superadmin/admin only — this is the comparative, cross-agent view.
router.get('/agent-performance', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const { start } = parseWindow(req.query)

    const businessHours = await getCompanyBusinessHours(companyId)
    const clientOrgBusinessHoursById = await getClientOrgBusinessHoursById(companyId)
    const categoryNameToId = await getCategoryNameToId(companyId)
    const slaRulesResult = await pool.query('SELECT priority, categoryId, clientOrgId, internalOnly, maxHours FROM SLARules WHERE companyId = $1', [companyId])
    const slaRules = slaRulesResult.rows

    // Every ticket assigned to any of this company's agents — resolved-
    // in-window stats and the live open count both come from this one
    // set, computed in JS below rather than as separate SQL aggregates.
    const ticketsResult = await pool.query(
      `SELECT t.id, t.assignedTo, t.status, t.priority, t.category, t.createdAt, t.resolvedAt, t.reopenedAt, t.clientOrgId, t.pausedBusinessHours, t.pendingSince
       FROM Tickets t
       JOIN Agents a ON a.name = t.assignedTo AND a.companyId = t.companyId
       WHERE t.companyId = $1`,
      [companyId]
    )

    const agentsResult = await pool.query('SELECT id, name, email FROM Agents WHERE companyId = $1 ORDER BY name', [companyId])

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

    const agents = agentsResult.rows.map(agent => {
      const ticketsForAgent = ticketsResult.rows.filter(t => t.assignedto === agent.name)
      const resolvedInWindow = ticketsForAgent.filter(t => t.status === 'Resolved' && t.resolvedat && new Date(t.resolvedat) >= start)
      const openCount = ticketsForAgent.filter(t => t.status !== 'Resolved').length

      const resolutionHours = resolvedInWindow.map(t => (new Date(t.resolvedat) - new Date(getTimerStart(t))) / (1000 * 60 * 60))
      const avgResolutionHours = resolutionHours.length > 0
        ? resolutionHours.reduce((sum, h) => sum + h, 0) / resolutionHours.length
        : null

      // Time spent waiting on the client, shown next to the SLA numbers
      // so a habit of parking tickets in Pending is visible.
      const pendingNowCount = ticketsForAgent.filter(t => t.status === 'Pending').length
      const pausedHoursResolved = resolvedInWindow.reduce((sum, t) => sum + (Number(t.pausedbusinesshours) || 0), 0)

      const eligible = resolvedInWindow.filter(t => isSlaEligible(t, slaRules, categoryNameToId))
      const breached = eligible.filter(t => isWithinSla(t, slaRules, businessHours, clientOrgBusinessHoursById, categoryNameToId) === false)

      return {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        resolvedCount: resolvedInWindow.length,
        openCount,
        avgResolutionHours,
        slaBreachRate: eligible.length > 0 ? (breached.length / eligible.length) * 100 : null,
        hoursLogged: hoursByEmail[agent.email] || 0,
        pendingNowCount,
        pausedHoursResolved
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
router.get('/ticket-trends', authenticateToken, requireSuperadmin, async (req, res) => {
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

    // Bucketing itself (date_trunc) stays in SQL — unaffected by
    // business hours, and doing it here guarantees these bucket keys
    // line up exactly with bucketsResult above. Only the eligible/
    // within-SLA classification per ticket happens in JS, since that
    // needs the business-hours-aware algorithm SQL can't run.
    const resolvedRawResult = await pool.query(
      `SELECT date_trunc($1, t.resolvedAt) AS bucket, t.priority, t.category, t.createdAt, t.resolvedAt, t.reopenedAt, t.clientOrgId, t.pausedBusinessHours, t.pendingSince
       FROM Tickets t
       WHERE t.companyId = $2 AND t.status = 'Resolved' AND t.resolvedAt >= $3`,
      [bucket, companyId, start]
    )

    const businessHours = await getCompanyBusinessHours(companyId)
    const clientOrgBusinessHoursById = await getClientOrgBusinessHoursById(companyId)
    const categoryNameToId = await getCategoryNameToId(companyId)
    const slaRulesResult = await pool.query('SELECT priority, categoryId, clientOrgId, internalOnly, maxHours FROM SLARules WHERE companyId = $1', [companyId])
    const slaRules = slaRulesResult.rows

    const byBucket = {}
    for (const row of resolvedRawResult.rows) {
      const key = new Date(row.bucket).toISOString()
      if (!byBucket[key]) byBucket[key] = { bucket: row.bucket, resolvedcnt: 0, eligiblecnt: 0, withinslacnt: 0 }
      byBucket[key].resolvedcnt++
      if (isSlaEligible(row, slaRules, categoryNameToId)) {
        byBucket[key].eligiblecnt++
        if (isWithinSla(row, slaRules, businessHours, clientOrgBusinessHoursById, categoryNameToId)) byBucket[key].withinslacnt++
      }
    }

    res.json(buildTrendSeries(bucketsResult.rows, createdResult.rows, Object.values(byBucket)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
