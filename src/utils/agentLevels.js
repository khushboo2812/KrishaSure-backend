const { pool } = require('../config/db')
const { PRIORITIES, sortLevels } = require('./assignment')

async function getCompanyLevels(companyId) {
  const result = await pool.query('SELECT id, name, rank FROM AgentLevels WHERE companyId = $1', [companyId])
  return sortLevels(result.rows)
}

// Which level name to store on an agent. `requested` is what the form
// sent: a level that exists is stored under its saved spelling, nothing
// sent means the company's lowest level, and a name that isn't one of
// the company's levels is refused (null). A company with no levels at
// all falls back to the old free-text behaviour.
async function resolveLevelName(companyId, requested) {
  const levels = await getCompanyLevels(companyId)
  if (levels.length === 0) return requested || 'Junior'
  if (!requested) return levels[0].name
  const match = levels.find(l => l.name.toLowerCase() === String(requested).trim().toLowerCase())
  return match ? match.name : null
}

// New companies start with the same ladder existing ones were migrated
// to: Junior < Senior, Low/Medium start at Junior, High/Urgent at Senior.
async function seedDefaultLevels(companyId) {
  const junior = await pool.query('INSERT INTO AgentLevels (companyId, name, rank) VALUES ($1, $2, 1) RETURNING id', [companyId, 'Junior'])
  const senior = await pool.query('INSERT INTO AgentLevels (companyId, name, rank) VALUES ($1, $2, 2) RETURNING id', [companyId, 'Senior'])
  const startFor = { Low: junior.rows[0].id, Medium: junior.rows[0].id, High: senior.rows[0].id, Urgent: senior.rows[0].id }
  for (const priority of PRIORITIES) {
    await pool.query(
      'INSERT INTO PriorityRouting (companyId, priority, startLevelId, escalate, maxLevelId) VALUES ($1, $2, $3, true, NULL)',
      [companyId, priority, startFor[priority]]
    )
  }
}

async function getRouting(companyId) {
  const [company, rows] = await Promise.all([
    pool.query('SELECT escalationEnabled FROM Companies WHERE id = $1', [companyId]),
    pool.query('SELECT priority, startLevelId, escalate, maxLevelId FROM PriorityRouting WHERE companyId = $1', [companyId])
  ])
  const byPriority = {}
  rows.rows.forEach(r => { byPriority[r.priority] = r })
  return {
    escalationEnabled: !!company.rows[0]?.escalationenabled,
    rows: PRIORITIES.map(priority => {
      const r = byPriority[priority]
      return { priority, startLevelId: r?.startlevelid ?? null, escalate: r ? r.escalate : true, maxLevelId: r?.maxlevelid ?? null }
    })
  }
}

// The level name a ticket of this priority starts at, or null when the
// company hasn't set one (then any matching agent is fine).
async function getStartLevelName(companyId, priority) {
  const result = await pool.query(
    `SELECT l.name FROM PriorityRouting r JOIN AgentLevels l ON l.id = r.startLevelId
     WHERE r.companyId = $1 AND r.priority = $2`,
    [companyId, priority]
  )
  return result.rows[0]?.name || null
}

module.exports = { getCompanyLevels, resolveLevelName, seedDefaultLevels, getRouting, getStartLevelName }
