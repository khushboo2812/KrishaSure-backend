const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireSuperadmin } = require('../middleware/auth')
const { PRIORITIES } = require('../utils/assignment')

// maxHours null means "no SLA limit" (see resolveSlaRule); otherwise it
// must be a whole number of hours above zero.
function validateRule({ priority, maxHours }) {
  if (!PRIORITIES.includes(priority)) return 'Pick a priority: Low, Medium, High or Urgent.'
  if (maxHours !== null && !(Number.isInteger(maxHours) && maxHours > 0)) return 'Enter the maximum hours as a whole number above zero, or choose no SLA limit.'
  return null
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query(
      `SELECT s.*, c.name as categoryName, o.name as clientOrgName
       FROM SLARules s
       LEFT JOIN Categories c ON s.categoryId = c.id
       LEFT JOIN ClientOrganizations o ON s.clientOrgId = o.id
       WHERE s.companyId = $1
       ORDER BY s.priority`,
      [companyId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const { priority, categoryId, clientOrgId, internalOnly, maxHours } = req.body
    const problem = validateRule({ priority, maxHours: maxHours ?? null })
    if (problem) return res.status(400).json({ error: problem })
    // internalOnly and clientOrgId are mutually exclusive — a rule
    // scoped to internal tickets never also names one specific client
    // org, same as a ticket itself is either tied to one client org or
    // is internal, never both.
    await pool.query(
      'INSERT INTO SLARules (priority, categoryId, clientOrgId, internalOnly, maxHours, companyId) VALUES ($1, $2, $3, $4, $5, $6)',
      [priority, categoryId || null, internalOnly ? null : (clientOrgId || null), !!internalOnly, maxHours ?? null, companyId]
    )
    res.status(201).json({ message: 'SLA rule created successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { priority, categoryId, clientOrgId, internalOnly, maxHours } = req.body
    const problem = validateRule({ priority, maxHours: maxHours ?? null })
    if (problem) return res.status(400).json({ error: problem })
    const result = await pool.query(
      'UPDATE SLARules SET priority = $1, categoryId = $2, clientOrgId = $3, internalOnly = $4, maxHours = $5 WHERE id = $6 AND companyId = $7',
      [priority, categoryId || null, internalOnly ? null : (clientOrgId || null), !!internalOnly, maxHours ?? null, id, companyId]
    )
    if (result.rowCount === 0) return res.status(404).json({ error: 'SLA rule not found' })
    res.json({ message: 'SLA rule updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    await pool.query('DELETE FROM SLARules WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'SLA rule deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
