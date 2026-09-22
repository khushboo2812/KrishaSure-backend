const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')

// One email per company per reason per cooldown window (see
// sql/add_limit_notifications.sql) — without this, someone repeatedly
// hitting a blocked action (retrying "Add User", mashing "Get AI
// Suggestion") would trigger a fresh email every single time.
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000

async function shouldNotify(companyId, reason) {
  const result = await pool.query(
    'SELECT lastSentAt FROM LimitNotifications WHERE companyId = $1 AND reason = $2',
    [companyId, reason]
  )
  const last = result.rows[0]?.lastsentat
  if (last && Date.now() - new Date(last).getTime() < NOTIFY_COOLDOWN_MS) return false

  await pool.query(
    `INSERT INTO LimitNotifications (companyId, reason, lastSentAt) VALUES ($1, $2, NOW())
     ON CONFLICT (companyId, reason) DO UPDATE SET lastSentAt = NOW()`,
    [companyId, reason]
  )
  return true
}

// This company's own superadmin(s) as the primary recipient, every
// platform_owner cc'd — same "who gets notified" shape as every other
// admin-facing email in this app (see routes/tickets.js's adminEmails
// pattern), just also including the platform owner. Falls back to
// putting platform owners in `to` if a company somehow has no
// superadmin, so the email still goes somewhere rather than nowhere.
async function getNotificationRecipients(companyId) {
  const superadmins = await pool.query(
    "SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1",
    [companyId]
  )
  const platformOwners = await pool.query(
    "SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'platform_owner'"
  )
  const superadminEmails = superadmins.rows.map(r => r.email).join(',')
  const platformOwnerEmails = platformOwners.rows.map(r => r.email).join(',')
  return superadminEmails
    ? { to: superadminEmails, cc: platformOwnerEmails || null }
    : { to: platformOwnerEmails, cc: null }
}

// Fire-and-forget, same as every other notification email in this
// app (routes/tickets.js never awaits sendEmail either) — a blocked
// request shouldn't sit waiting on an email send before returning its
// error to the person who got blocked.
function notifyLimitCrossed(companyId, reason, details) {
  shouldNotify(companyId, reason).then(async (due) => {
    if (!due) return
    const companyResult = await pool.query('SELECT name FROM Companies WHERE id = $1', [companyId])
    const company = companyResult.rows[0]
    if (!company) return
    const { to, cc } = await getNotificationRecipients(companyId)
    if (!to) return

    const { subject, bodyHtml } = buildLimitEmail(company.name, reason, details)
    sendEmail(
      to,
      subject,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">${subject}</h1>
          ${bodyHtml}
          <p style="color: #64748B; font-size: 13px;">You can adjust ${company.name}'s plan limits from the Platform Dashboard's Companies tab.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      cc
    )
  }).catch(err => console.error('Failed to send limit-crossed notification:', err.message))
}

function buildLimitEmail(companyName, reason, details) {
  if (reason === 'user_limit') {
    return {
      subject: `${companyName} hit its user limit`,
      bodyHtml: `<p>Someone just tried to add a new user to <strong>${companyName}</strong>, but the company is already at its plan's limit of <strong>${details.maxUsers} users</strong>.</p>`
    }
  }
  if (reason === 'ai_disabled') {
    return {
      subject: `${companyName} tried to use AI — not on their plan`,
      bodyHtml: `<p>Someone at <strong>${companyName}</strong> just tried to use the AI assistant, but this company's current plan doesn't include AI.</p>`
    }
  }
  return {
    subject: `${companyName} hit its monthly AI limit`,
    bodyHtml: `<p><strong>${companyName}</strong> has used all <strong>${details.maxAiRequestsPerMonth} AI requests</strong> included in its plan for this month. It resets automatically at the start of next month.</p>`
  }
}

// Counts active memberships only — a deactivated member shouldn't
// count against a company's seat limit, same principle as
// isLastActiveSuperadmin elsewhere in this file's sibling routes.
//
// enforceUsageLimits lives on the company itself, not a single global
// switch — this was a global toggle at first, but that meant turning
// it on for one pilot client turned it on for every company at once.
// Per-company means it can be rolled out to one client at a time.
async function checkUserLimit(companyId) {
  const companyResult = await pool.query('SELECT enforceUsageLimits, maxUsers FROM Companies WHERE id = $1', [companyId])
  const company = companyResult.rows[0]
  if (!company || !company.enforceusagelimits) return { allowed: true }
  if (company.maxusers == null) return { allowed: true }

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM Memberships WHERE companyId = $1 AND isActive = true',
    [companyId]
  )
  if (parseInt(countResult.rows[0].count, 10) >= company.maxusers) {
    notifyLimitCrossed(companyId, 'user_limit', { maxUsers: company.maxusers })
    return { allowed: false, status: 403, message: `This company has reached its plan's limit of ${company.maxusers} users — contact your platform administrator to upgrade.` }
  }
  return { allowed: true }
}

// Checked at the top of both AI routes, and by GET /api/ai/status for
// the frontend to decide whether to show the "Get AI Suggestion"
// button at all. Deliberately has no side effects (doesn't notify,
// doesn't log usage) — it's a pure question, "can this company use AI
// right now" — so calling it from a passive status check never fires
// a false "someone tried to use AI" email. Callers that represent a
// real attempt (the AI routes below) notify themselves using the
// returned reason/details when blocked.
//
// aiEnabled gates AI off entirely (the No-AI tier);
// maxAiRequestsPerMonth caps how many calls a company can make in the
// current calendar month, counted against AiUsageLog — which
// logAiUsage below writes to unconditionally, so the count is already
// accurate the moment enforcement gets switched on, not just from
// that point forward.
async function checkAiAccess(companyId) {
  const companyResult = await pool.query('SELECT enforceUsageLimits, aiEnabled, maxAiRequestsPerMonth FROM Companies WHERE id = $1', [companyId])
  const company = companyResult.rows[0]
  if (!company || !company.enforceusagelimits) return { allowed: true }
  if (!company.aienabled) {
    return { allowed: false, status: 403, message: 'AI features are not included in your current plan — contact your platform administrator to upgrade.', reason: 'ai_disabled', details: {} }
  }
  if (company.maxairequestspermonth == null) return { allowed: true }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM AiUsageLog WHERE companyId = $1 AND createdAt >= date_trunc('month', NOW())`,
    [companyId]
  )
  if (parseInt(countResult.rows[0].count, 10) >= company.maxairequestspermonth) {
    return { allowed: false, status: 429, message: `Your plan's AI usage limit (${company.maxairequestspermonth} requests/month) has been reached — it resets at the start of next month, or contact your platform administrator to upgrade.`, reason: 'ai_request_limit', details: { maxAiRequestsPerMonth: company.maxairequestspermonth } }
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

module.exports = { checkUserLimit, checkAiAccess, logAiUsage, notifyLimitCrossed }
