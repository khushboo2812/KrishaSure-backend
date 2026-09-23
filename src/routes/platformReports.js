const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requirePlatformOwner } = require('../middleware/auth')
const { parseWindow, buildTrendSeries, buildSignupsSeries } = require('../utils/reportTrends')
const { isContractActive, advancePeriodIfDue, computeOrgBalance } = require('../utils/contractPeriod')
const { businessHoursElapsed, getEffectiveBusinessHours } = require('../utils/businessHours')

// Everything in this file is platform-owner only and deliberately never
// filters by companyId — it's the cross-company view. Company-scoped
// reporting lives in routes/reports.js.
router.use(authenticateToken, requirePlatformOwner)

// GET counts of companies by companyType and by tier.
router.get('/companies-summary', async (req, res) => {
  try {
    const result = await pool.query('SELECT companyType, tier FROM Companies')
    const byType = {}
    const byTier = {}
    result.rows.forEach(r => {
      byType[r.companytype] = (byType[r.companytype] || 0) + 1
      byTier[r.tier] = (byTier[r.tier] || 0) + 1
    })
    res.json({ total: result.rows.length, byType, byTier })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET platform-wide ticket volume (created vs resolved) and SLA
// compliance %, time-bucketed. Same shape and helper as the
// company-scoped version in routes/reports.js, just without the
// companyId filter.
router.get('/ticket-trends', async (req, res) => {
  try {
    const { bucket, now, start } = parseWindow(req.query)

    const bucketsResult = await pool.query(
      `SELECT generate_series(date_trunc($1, $2::timestamptz), date_trunc($1, $3::timestamptz), ('1 ' || $1)::interval) AS bucket`,
      [bucket, start, now]
    )

    const createdResult = await pool.query(
      `SELECT date_trunc($1, createdAt) AS bucket, COUNT(*) AS cnt
       FROM Tickets WHERE createdAt >= $2
       GROUP BY 1`,
      [bucket, start]
    )

    // Bucketing stays in SQL (unaffected by business hours, and this
    // guarantees the bucket keys line up with bucketsResult above).
    // Eligible/within-SLA classification happens in JS per ticket,
    // against its OWN company's business hours and SLA rules — this
    // report spans every company, and they don't all share one
    // business-hours config, so there's no single SQL expression that
    // could classify every row correctly.
    const resolvedRawResult = await pool.query(
      `SELECT date_trunc($1, t.resolvedAt) AS bucket, t.companyId, t.clientOrgId, t.priority, t.createdAt, t.resolvedAt, t.pausedBusinessHours
       FROM Tickets t
       WHERE t.status = 'Resolved' AND t.resolvedAt >= $2`,
      [bucket, start]
    )

    const companiesResult = await pool.query('SELECT id, businessDays, businessHoursStart, businessHoursEnd, timezone FROM Companies')
    const businessHoursByCompany = {}
    companiesResult.rows.forEach(c => {
      businessHoursByCompany[c.id] = {
        businessDays: c.businessdays,
        businessHoursStart: c.businesshoursstart,
        businessHoursEnd: c.businesshoursend,
        timezone: c.timezone
      }
    })

    // Keyed by clientOrgId (not companyId — multiple client orgs, each
    // possibly under a different company, can each have their own
    // override) so a per-ticket lookup is a plain object read.
    const clientOrgsResult = await pool.query('SELECT id, businessDays, businessHoursStart, businessHoursEnd, timezone FROM ClientOrganizations')
    const businessHoursByClientOrg = {}
    clientOrgsResult.rows.forEach(c => {
      businessHoursByClientOrg[c.id] = {
        businessDays: c.businessdays,
        businessHoursStart: c.businesshoursstart,
        businessHoursEnd: c.businesshoursend,
        timezone: c.timezone
      }
    })

    const slaRulesResult = await pool.query('SELECT companyId, priority, categoryId, maxHours FROM SLARules')
    const slaRulesByCompany = {}
    slaRulesResult.rows.forEach(r => {
      if (!slaRulesByCompany[r.companyid]) slaRulesByCompany[r.companyid] = []
      slaRulesByCompany[r.companyid].push(r)
    })

    const byBucket = {}
    for (const row of resolvedRawResult.rows) {
      const key = new Date(row.bucket).toISOString()
      if (!byBucket[key]) byBucket[key] = { bucket: row.bucket, resolvedcnt: 0, eligiblecnt: 0, withinslacnt: 0 }
      byBucket[key].resolvedcnt++

      const rules = slaRulesByCompany[row.companyid] || []
      const rule = rules.find(r => r.priority === row.priority && r.categoryid === null)
      if (rule) {
        byBucket[key].eligiblecnt++
        const effective = getEffectiveBusinessHours(businessHoursByCompany[row.companyid], businessHoursByClientOrg[row.clientorgid])
        const hrs = businessHoursElapsed(row.createdat, row.resolvedat, effective) - (Number(row.pausedbusinesshours) || 0)
        if (hrs <= rule.maxhours) byBucket[key].withinslacnt++
      }
    }

    res.json(buildTrendSeries(bucketsResult.rows, createdResult.rows, Object.values(byBucket)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET ticket volume per company within the window, most active first.
// Companies with zero tickets in the window still appear (LEFT JOIN),
// sinking to the bottom of the ranking.
router.get('/company-activity', async (req, res) => {
  try {
    const { start } = parseWindow(req.query)
    const result = await pool.query(
      `SELECT c.id, c.name, c.companyType, c.tier, COUNT(t.id) AS ticketcount
       FROM Companies c
       LEFT JOIN Tickets t ON t.companyId = c.id AND t.createdAt >= $1
       GROUP BY c.id, c.name, c.companyType, c.tier
       ORDER BY ticketcount DESC, c.name`,
      [start]
    )
    res.json(result.rows.map(r => ({
      id: r.id,
      name: r.name,
      companyType: r.companytype,
      tier: r.tier,
      ticketCount: parseInt(r.ticketcount)
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET new user signups vs email verifications, time-bucketed.
// platform_owner is excluded — there's only ever one, not a meaningful
// trend signal.
router.get('/signups-trend', async (req, res) => {
  try {
    const { bucket, now, start } = parseWindow(req.query)

    const bucketsResult = await pool.query(
      `SELECT generate_series(date_trunc($1, $2::timestamptz), date_trunc($1, $3::timestamptz), ('1 ' || $1)::interval) AS bucket`,
      [bucket, start, now]
    )

    // A person counts as a "signup"/"verification" unless one of their
    // memberships is platform_owner — there's only ever one, not a
    // meaningful trend signal, and a person could in principle also
    // hold other memberships alongside it.
    const signupsResult = await pool.query(
      `SELECT date_trunc($1, p.createdAt) AS bucket, COUNT(*) AS cnt
       FROM People p
       WHERE p.createdAt >= $2
         AND NOT EXISTS (SELECT 1 FROM Memberships m WHERE m.personId = p.id AND m.role = 'platform_owner')
       GROUP BY 1`,
      [bucket, start]
    )

    const verifiedResult = await pool.query(
      `SELECT date_trunc($1, p.emailVerifiedAt) AS bucket, COUNT(*) AS cnt
       FROM People p
       WHERE p.emailVerifiedAt >= $2
         AND NOT EXISTS (SELECT 1 FROM Memberships m WHERE m.personId = p.id AND m.role = 'platform_owner')
       GROUP BY 1`,
      [bucket, start]
    )

    res.json(buildSignupsSeries(bucketsResult.rows, signupsResult.rows, verifiedResult.rows))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET every MSP company's client org that's currently in overtime,
// across all companies. Reuses the exact same isContractActive /
// advancePeriodIfDue / computeOrgBalance path the per-company
// hours-balance endpoint uses, so "in overtime" means the same thing
// here as it does everywhere else in the app — just swept across every
// MSP company instead of one at a time.
router.get('/msp-overtime', async (req, res) => {
  try {
    const candidatesResult = await pool.query(
      `SELECT co.*, c.name AS companyname
       FROM ClientOrganizations co
       JOIN Companies c ON co.companyId = c.id
       WHERE c.companyType = 'msp' AND co.hasHoursContract = true`
    )

    const overOrgs = []
    for (const rawOrg of candidatesResult.rows) {
      if (!isContractActive(rawOrg)) continue
      const org = await advancePeriodIfDue(pool, rawOrg)
      const balance = await computeOrgBalance(pool, org)
      if (balance.overtimeHours > 0) {
        overOrgs.push({
          companyId: org.companyid,
          companyName: rawOrg.companyname,
          clientOrgId: org.id,
          clientOrgName: org.name,
          contractedHours: balance.contractedHours,
          overtimeHours: balance.overtimeHours,
          resetCadence: balance.resetCadence,
          currentPeriodStart: balance.currentPeriodStart
        })
      }
    }

    overOrgs.sort((a, b) => b.overtimeHours - a.overtimeHours)
    res.json(overOrgs)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
