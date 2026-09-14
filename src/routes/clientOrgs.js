const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken } = require('../middleware/auth')

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT * FROM ClientOrganizations WHERE companyId = $1 ORDER BY name', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, hasHoursContract, contractedHours, resetCadence, overtimeHandling } = req.body

    await pool.query(
      `INSERT INTO ClientOrganizations (name, companyId, hasHoursContract, contractedHours, resetCadence, overtimeHandling, currentPeriodStart) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, companyId, hasHoursContract || false, contractedHours || null, resetCadence || null, overtimeHandling || null, hasHoursContract ? new Date() : null]
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

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { name, hasHoursContract, contractedHours, resetCadence, overtimeHandling } = req.body

    const existing = await pool.query('SELECT * FROM ClientOrganizations WHERE id = $1 AND companyId = $2', [id, companyId])
    const org = existing.rows[0]

    if (!org) {
      return res.status(404).json({ error: 'Client organization not found' })
    }

    // If a contract is being turned on for the first time, start the period now
    const periodStart = (hasHoursContract && !org.hashourscontract) ? new Date() : org.currentperiodstart

    await pool.query(
      `UPDATE ClientOrganizations 
       SET name = $1, hasHoursContract = $2, contractedHours = $3, resetCadence = $4, overtimeHandling = $5, currentPeriodStart = $6
       WHERE id = $7 AND companyId = $8`,
      [name, hasHoursContract, contractedHours || null, resetCadence || null, overtimeHandling || null, hasHoursContract ? periodStart : null, id, companyId]
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
    const org = orgResult.rows[0]

    if (!org || !org.hashourscontract) {
      return res.json({ hasContract: false })
    }

    const usedResult = await pool.query(
      `SELECT COALESCE(SUM(h.hoursSpent), 0) as totalUsed
       FROM HoursLog h
       JOIN Tickets t ON h.ticketId = t.id
       WHERE t.clientOrgId = $1 AND h.loggedAt >= $2`,
      [id, org.currentperiodstart]
    )

    const totalUsed = parseFloat(usedResult.rows[0].totalused)
    const contracted = parseFloat(org.contractedhours)
    const remaining = contracted - totalUsed

    res.json({
      hasContract: true,
      contractedHours: contracted,
      hoursUsed: totalUsed,
      hoursRemaining: remaining > 0 ? remaining : 0,
      overtimeHours: remaining < 0 ? Math.abs(remaining) : 0,
      resetCadence: org.resetcadence,
      currentPeriodStart: org.currentperiodstart
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router