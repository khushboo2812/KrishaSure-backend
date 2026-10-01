// Loaders and the SLA-rule resolver shared by the reports routes and the
// escalation job (utils/escalation.js), so both read business hours and
// pick a ticket's SLA rule exactly the same way.
const { pool } = require('../config/db')

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

async function getCompanySlaRules(companyId) {
  const result = await pool.query('SELECT priority, categoryId, clientOrgId, internalOnly, maxHours FROM SLARules WHERE companyId = $1', [companyId])
  return result.rows
}

module.exports = { idsMatch, resolveSlaRule, getCompanyBusinessHours, getClientOrgBusinessHoursById, getCategoryNameToId, getCompanySlaRules }
