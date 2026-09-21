const { pool } = require('../config/db')

// Single global switch for whether any of the checks below actually
// block anything (see sql/add_usage_limits.sql). Everything in this
// file is a no-op — always allowed — while this is false, so having
// this wired into user creation and the AI routes ahead of assigning
// real tiers/limits to any company doesn't change behavior today.
async function isEnforcementOn() {
  const result = await pool.query('SELECT enforceUsageLimits FROM PlatformSettings WHERE id = 1')
  return result.rows[0]?.enforceusagelimits === true
}

// Counts active memberships only — a deactivated member shouldn't
// count against a company's seat limit, same principle as
// isLastActiveSuperadmin elsewhere in this file's sibling routes.
async function checkUserLimit(companyId) {
  if (!(await isEnforcementOn())) return { allowed: true }

  const companyResult = await pool.query('SELECT maxUsers FROM Companies WHERE id = $1', [companyId])
  const maxUsers = companyResult.rows[0]?.maxusers
  if (maxUsers == null) return { allowed: true }

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM Memberships WHERE companyId = $1 AND isActive = true',
    [companyId]
  )
  if (parseInt(countResult.rows[0].count, 10) >= maxUsers) {
    return { allowed: false, status: 403, message: `This company has reached its plan's limit of ${maxUsers} users — contact your platform administrator to upgrade.` }
  }
  return { allowed: true }
}

// Checked at the top of both AI routes. aiEnabled gates AI off
// entirely (the No-AI tier); maxAiRequestsPerMonth caps how many
// calls a company can make in the current calendar month, counted
// against AiUsageLog — which logAiUsage below writes to
// unconditionally, so the count is already accurate the moment
// enforcement gets switched on, not just from that point forward.
async function checkAiAccess(companyId) {
  if (!(await isEnforcementOn())) return { allowed: true }

  const companyResult = await pool.query('SELECT aiEnabled, maxAiRequestsPerMonth FROM Companies WHERE id = $1', [companyId])
  const company = companyResult.rows[0]
  if (!company || !company.aienabled) {
    return { allowed: false, status: 403, message: 'AI features are not included in your current plan — contact your platform administrator to upgrade.' }
  }
  if (company.maxairequestspermonth == null) return { allowed: true }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM AiUsageLog WHERE companyId = $1 AND createdAt >= date_trunc('month', NOW())`,
    [companyId]
  )
  if (parseInt(countResult.rows[0].count, 10) >= company.maxairequestspermonth) {
    return { allowed: false, status: 429, message: `Your plan's AI usage limit (${company.maxairequestspermonth} requests/month) has been reached — it resets at the start of next month, or contact your platform administrator to upgrade.` }
  }
  return { allowed: true }
}

// Logs unconditionally (not gated on isEnforcementOn) so a company's
// usage history stays accurate regardless of when enforcement gets
// switched on, and so this data is usable for real pricing decisions
// even while enforcement stays off.
async function logAiUsage(companyId, route) {
  await pool.query('INSERT INTO AiUsageLog (companyId, route) VALUES ($1, $2)', [companyId, route])
}

module.exports = { checkUserLimit, checkAiAccess, logAiUsage }
