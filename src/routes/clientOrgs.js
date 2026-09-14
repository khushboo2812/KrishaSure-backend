const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')
const { isContractActive, advancePeriodIfDue } = require('../utils/contractPeriod')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM ClientOrganizations WHERE companyId = $1 ORDER BY name', [companyId])
    // contractActive folds in contractEndDate so a lapsed contract behaves
    // like no contract at all (hours optional, no overtime badge/status)
    // without every consumer needing its own expiry-date logic.
    const orgs = result.rows.map(org => ({ ...org, contractactive: isContractActive(org) }))
    res.json(orgs)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, hasHoursContract, contractedHours, resetCadence, overtimeHandling, contractEndDate } = req.body

    await pool.query(
      `INSERT INTO ClientOrganizations (name, companyId, hasHoursContract, contractedHours, resetCadence, overtimeHandling, contractEndDate, currentPeriodStart)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [name, companyId, hasHoursContract || false, contractedHours || null, resetCadence || null, overtimeHandling || null, hasHoursContract ? (contractEndDate || null) : null, hasHoursContract ? new Date() : null]
    )
    res.status(201).json({ message: 'Client organization created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await pool.query('DELETE FROM ClientOrganizations WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'Client organization deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Contract terms are considered changed if hasHoursContract flips, or (while
// under contract, before or after the edit) contractedHours, resetCadence,
// or overtimeHandling differ. A plain rename alone never counts.
function contractTermsChanged(org, next) {
  const toHours = v => (v === null || v === undefined || v === '') ? null : parseFloat(v)
  const toText = v => v === undefined ? null : v

  return !!org.hashourscontract !== !!next.hasHoursContract ||
    toHours(org.contractedhours) !== toHours(next.contractedHours) ||
    toText(org.resetcadence) !== toText(next.resetCadence) ||
    toText(org.overtimehandling) !== toText(next.overtimeHandling)
}

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId, email } = req.user
    const { name, hasHoursContract, contractedHours, resetCadence, overtimeHandling, contractEndDate } = req.body

    const existing = await pool.query('SELECT * FROM ClientOrganizations WHERE id = $1 AND companyId = $2', [id, companyId])
    const org = existing.rows[0]

    if (!org) {
      return res.status(404).json({ error: 'Client organization not found' })
    }

    // If a contract is being turned on for the first time, start the period now
    const periodStart = (hasHoursContract && !org.hashourscontract) ? new Date() : org.currentperiodstart

    if (contractTermsChanged(org, { hasHoursContract, contractedHours, resetCadence, overtimeHandling })) {
      await pool.query(
        `INSERT INTO ClientContractHistory (clientOrgId, previousContractedHours, previousResetCadence, previousOvertimeHandling, changedBy)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, org.contractedhours, org.resetcadence, org.overtimehandling, email]
      )
    }

    await pool.query(
      `UPDATE ClientOrganizations
       SET name = $1, hasHoursContract = $2, contractedHours = $3, resetCadence = $4, overtimeHandling = $5, contractEndDate = $6, currentPeriodStart = $7
       WHERE id = $8 AND companyId = $9`,
      [name, hasHoursContract, contractedHours || null, resetCadence || null, overtimeHandling || null, hasHoursContract ? (contractEndDate || null) : null, hasHoursContract ? periodStart : null, id, companyId]
    )

    res.json({ message: 'Client organization updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id/hours-balance', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const orgResult = await pool.query('SELECT * FROM ClientOrganizations WHERE id = $1 AND companyId = $2', [id, companyId])
    let org = orgResult.rows[0]

    // Lapsed (contractEndDate passed) is treated the same as no contract.
    if (!org || !isContractActive(org)) {
      return res.json({ hasContract: false })
    }

    // Lazily roll currentPeriodStart past any fully-elapsed resetCadence
    // periods before computing usage, applying overtimeHandling at each
    // boundary (see src/utils/contractPeriod.js).
    org = await advancePeriodIfDue(pool, org)

    const usedResult = await pool.query(
      `SELECT COALESCE(SUM(h.hoursSpent), 0) as totalUsed
       FROM HoursLog h
       JOIN Tickets t ON h.ticketId = t.id
       WHERE t.clientOrgId = $1 AND h.loggedAt >= $2`,
      [id, org.currentperiodstart]
    )

    const totalUsed = parseFloat(usedResult.rows[0].totalused)
    const contracted = parseFloat(org.contractedhours)
    const carriedOverHours = parseFloat(org.carriedoverhours || 0)
    // A rolled-over debt eats into this period's allowance; "Settle
    // separately" orgs always have carriedOverHours at 0, so this is a
    // no-op for them.
    const remaining = (contracted - carriedOverHours) - totalUsed

    res.json({
      hasContract: true,
      contractedHours: contracted,
      carriedOverHours,
      hoursUsed: totalUsed,
      hoursRemaining: remaining > 0 ? remaining : 0,
      overtimeHours: remaining < 0 ? Math.abs(remaining) : 0,
      resetCadence: org.resetcadence,
      currentPeriodStart: org.currentperiodstart,
      contractEndDate: org.contractenddate
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router