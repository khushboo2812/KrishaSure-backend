const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireSuperadmin } = require('../middleware/auth')
const { PRIORITIES } = require('../utils/assignment')
const { getCompanyLevels, getRouting } = require('../utils/agentLevels')

// The Assignment & Escalation matrix: per priority, which level new
// tickets start at, whether a breached ticket escalates, and the
// highest level it may reach.
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'supplier') return res.json({ escalationEnabled: false, rows: [] })
    res.json(await getRouting(req.user.companyId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const { escalationEnabled, rows } = req.body
    if (typeof escalationEnabled !== 'boolean' || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'Send escalationEnabled and a row for each priority.' })
    }

    const levels = await getCompanyLevels(companyId)
    const rankById = {}
    levels.forEach(l => { rankById[Number(l.id)] = l.rank })

    const seen = new Set()
    const clean = []
    for (const row of rows) {
      if (!PRIORITIES.includes(row.priority) || seen.has(row.priority)) {
        return res.status(400).json({ error: 'Each priority must appear once: Low, Medium, High, Urgent.' })
      }
      seen.add(row.priority)
      const startLevelId = row.startLevelId == null || row.startLevelId === '' ? null : Number(row.startLevelId)
      const maxLevelId = row.maxLevelId == null || row.maxLevelId === '' ? null : Number(row.maxLevelId)
      if ((startLevelId !== null && !(startLevelId in rankById)) || (maxLevelId !== null && !(maxLevelId in rankById))) {
        return res.status(400).json({ error: 'That level no longer exists — refresh and try again.' })
      }
      if (startLevelId !== null && maxLevelId !== null && rankById[maxLevelId] < rankById[startLevelId]) {
        return res.status(400).json({ error: `${row.priority}: the highest level it can reach can't be below the level it starts at.` })
      }
      clean.push({ priority: row.priority, startLevelId, escalate: row.escalate !== false, maxLevelId })
    }
    if (seen.size !== PRIORITIES.length) {
      return res.status(400).json({ error: 'Each priority must appear once: Low, Medium, High, Urgent.' })
    }

    await pool.query('UPDATE Companies SET escalationEnabled = $1 WHERE id = $2', [escalationEnabled, companyId])
    for (const r of clean) {
      await pool.query(
        `INSERT INTO PriorityRouting (companyId, priority, startLevelId, escalate, maxLevelId) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (companyId, priority) DO UPDATE SET startLevelId = $3, escalate = $4, maxLevelId = $5`,
        [companyId, r.priority, r.startLevelId, r.escalate, r.maxLevelId]
      )
    }
    res.json({ message: 'Assignment & escalation settings saved!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
