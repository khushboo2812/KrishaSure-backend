const express = require('express')
const router = express.Router()
const { pool } = require('../config/db')
const { authenticateToken, requireSuperadmin } = require('../middleware/auth')
const { getCompanyLevels } = require('../utils/agentLevels')

const MAX_NAME_LENGTH = 50

function cleanName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
}

async function nameTaken(companyId, name, exceptId = null) {
  const result = await pool.query(
    'SELECT id FROM AgentLevels WHERE companyId = $1 AND LOWER(name) = LOWER($2) AND ($3::int IS NULL OR id != $3::int)',
    [companyId, name, exceptId]
  )
  return result.rows.length > 0
}

// Anyone who can hold tickets or raise them needs the list (level
// dropdowns, auto-assignment on the create-ticket form). Suppliers are
// outside the ladder, so they get none.
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'supplier') return res.json([])
    const { companyId } = req.user
    const levels = await getCompanyLevels(companyId)
    const counts = await pool.query('SELECT level, COUNT(*) AS agents FROM Agents WHERE companyId = $1 GROUP BY level', [companyId])
    const byName = {}
    counts.rows.forEach(r => { byName[r.level] = parseInt(r.agents, 10) })
    res.json(levels.map(l => ({ id: l.id, name: l.name, rank: l.rank, agentCount: byName[l.name] || 0 })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// A new level goes on top of the ladder; reorder it afterwards.
router.post('/', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const name = cleanName(req.body.name)
    if (!name) return res.status(400).json({ error: 'Enter a name for the level.' })
    if (name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.` })
    if (await nameTaken(companyId, name)) return res.status(400).json({ error: `You already have a level called ${name}.` })

    const top = await pool.query('SELECT COALESCE(MAX(rank), 0) AS maxrank FROM AgentLevels WHERE companyId = $1', [companyId])
    await pool.query('INSERT INTO AgentLevels (companyId, name, rank) VALUES ($1, $2, $3)', [companyId, name, top.rows[0].maxrank + 1])
    res.status(201).json({ message: 'Level added!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/reorder', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { companyId } = req.user
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : []
    const levels = await getCompanyLevels(companyId)
    const known = levels.map(l => Number(l.id)).sort((a, b) => a - b)
    if (ids.length !== known.length || [...ids].sort((a, b) => a - b).some((id, i) => id !== known[i])) {
      return res.status(400).json({ error: 'The list changed — refresh and try again.' })
    }
    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE AgentLevels SET rank = $1 WHERE id = $2 AND companyId = $3', [i + 1, ids[i], companyId])
    }
    res.json({ message: 'Order saved!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Renaming also renames it on every agent holding it, since an agent's
// level is stored by name.
router.put('/:id', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const name = cleanName(req.body.name)
    if (!name) return res.status(400).json({ error: 'Enter a name for the level.' })
    if (name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.` })

    const existing = await pool.query('SELECT name FROM AgentLevels WHERE id = $1 AND companyId = $2', [id, companyId])
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Level not found' })
    if (await nameTaken(companyId, name, Number(id))) return res.status(400).json({ error: `You already have a level called ${name}.` })

    await pool.query('UPDATE AgentLevels SET name = $1 WHERE id = $2 AND companyId = $3', [name, id, companyId])
    await pool.query('UPDATE Agents SET level = $1 WHERE level = $2 AND companyId = $3', [name, existing.rows[0].name, companyId])
    res.json({ message: 'Level renamed!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const existing = await pool.query('SELECT name FROM AgentLevels WHERE id = $1 AND companyId = $2', [id, companyId])
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Level not found' })
    const { name } = existing.rows[0]

    const inUse = await pool.query('SELECT COUNT(*) AS agents FROM Agents WHERE level = $1 AND companyId = $2', [name, companyId])
    const agents = parseInt(inUse.rows[0].agents, 10)
    if (agents > 0) {
      return res.status(400).json({ error: `${agents} agent${agents === 1 ? '' : 's'} ${agents === 1 ? 'is' : 'are'} at ${name}. Move them to another level first.` })
    }
    const routed = await pool.query(
      'SELECT priority FROM PriorityRouting WHERE companyId = $1 AND (startLevelId = $2 OR maxLevelId = $2) ORDER BY priority',
      [companyId, id]
    )
    if (routed.rows.length > 0) {
      return res.status(400).json({ error: `${name} is used in the Assignment & Escalation matrix (${routed.rows.map(r => r.priority).join(', ')}). Change those rows first.` })
    }

    await pool.query('DELETE FROM AgentLevels WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'Level deleted!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
