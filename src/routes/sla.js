const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireSuperadmin } = require('../middleware/auth')

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
    // internalOnly and clientOrgId are mutually exclusive — a rule
    // scoped to internal tickets never also names one specific client
    // org, same as a ticket itself is either tied to one client org or
    // is internal, never both.
    await pool.query(
      'INSERT INTO SLARules (priority, categoryId, clientOrgId, internalOnly, maxHours, companyId) VALUES ($1, $2, $3, $4, $5, $6)',
      [priority, categoryId || null, internalOnly ? null : (clientOrgId || null), !!internalOnly, maxHours, companyId]
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
    await pool.query(
      'UPDATE SLARules SET priority = $1, categoryId = $2, clientOrgId = $3, internalOnly = $4, maxHours = $5 WHERE id = $6 AND companyId = $7',
      [priority, categoryId || null, internalOnly ? null : (clientOrgId || null), !!internalOnly, maxHours, id, companyId]
    )
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
