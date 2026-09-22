const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getNotificationRecipients } = require('./usageLimits')
const { workingDaysBetween } = require('./workingDays')

const GRACE_PERIOD_WORKING_DAYS = 30

// Call after anything that can change a company's active-user count
// while enforcement is on: saving its plan limits (companies.js), or
// deactivating/reactivating/removing a membership (users.js). Detects
// the two transitions that matter — going over the limit for the
// first time, and coming back within it — and does nothing on every
// other call (most calls change nothing). Idempotent: safe to call
// after any membership or plan-limit change without checking first
// whether it's actually relevant.
async function checkAndTrackOverLimit(companyId) {
  const companyResult = await pool.query(
    'SELECT name, enforceUsageLimits, maxUsers, overLimitSince FROM Companies WHERE id = $1',
    [companyId]
  )
  const company = companyResult.rows[0]
  if (!company) return

  // Enforcement off, or no seat cap set — there's no "over the limit"
  // to track. Clear any stale tracking from before either changed.
  if (!company.enforceusagelimits || company.maxusers == null) {
    if (company.overlimitsince) await clearOverLimit(companyId)
    return
  }

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM Memberships WHERE companyId = $1 AND isActive = true',
    [companyId]
  )
  const activeCount = parseInt(countResult.rows[0].count, 10)
  const isOver = activeCount > company.maxusers

  if (isOver && !company.overlimitsince) {
    await pool.query('UPDATE Companies SET overLimitSince = NOW(), overLimitLockedOut = false WHERE id = $1', [companyId])
    notifyOverLimitWarning(companyId, company.name, activeCount, company.maxusers)
  } else if (!isOver && company.overlimitsince) {
    await clearOverLimit(companyId)
  }
}

async function clearOverLimit(companyId) {
  await pool.query('UPDATE Companies SET overLimitSince = NULL, overLimitLockedOut = false WHERE id = $1', [companyId])
}

// Fire-and-forget, same as every other notification email in this app.
function notifyOverLimitWarning(companyId, companyName, activeCount, maxUsers) {
  getNotificationRecipients(companyId).then(({ to, cc }) => {
    if (!to) return
    sendEmail(
      to,
      `${companyName} is over its plan's user limit`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">${companyName} is over its plan's user limit</h1>
          <p><strong>${companyName}</strong> currently has <strong>${activeCount} active users</strong>, but its plan allows <strong>${maxUsers}</strong>.</p>
          <p>You have <strong>${GRACE_PERIOD_WORKING_DAYS} working days</strong> to either deactivate users to fit your plan, or upgrade to a plan with more seats.</p>
          <p style="color: #DC2626; font-weight: 600;">If nothing changes by then, extra users will be automatically deactivated — one superadmin will keep access so you can fix this, but everyone else will be locked out until you do.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      cc
    )
  }).catch(err => console.error('Failed to send over-limit warning:', err.message))
}

// Run on a schedule (see index.js) — checks every company sitting over
// its limit and enforces the ones whose grace period has run out.
// Picks the longest-standing active superadmin to keep access
// (deterministic, so a re-run after a partial failure doesn't pick
// someone different) and deactivates every other active membership —
// reusing the exact same Memberships.isActive flag the manual
// Deactivate/Reactivate button already uses, so undoing this later is
// just the admin clicking Reactivate on whoever they bring back, no
// separate "locked out by the system" state to unwind.
async function enforceExpiredGracePeriods() {
  const overdue = await pool.query(
    `SELECT id, name, maxUsers, overLimitSince FROM Companies
     WHERE overLimitSince IS NOT NULL AND overLimitLockedOut = false AND enforceUsageLimits = true`
  )

  for (const company of overdue.rows) {
    const elapsed = workingDaysBetween(company.overlimitsince, new Date())
    if (elapsed < GRACE_PERIOD_WORKING_DAYS) continue

    const keepResult = await pool.query(
      `SELECT m.id, p.email, p.name FROM Memberships m JOIN People p ON m.personId = p.id
       WHERE m.companyId = $1 AND m.role = 'superadmin' AND m.isActive = true
       ORDER BY m.id ASC LIMIT 1`,
      [company.id]
    )
    const keep = keepResult.rows[0]
    // No active superadmin at all to retain access — skip enforcing
    // rather than risk locking the whole company out with no way back
    // in. Extremely unlikely (would mean the company had no
    // superadmin already), but a company in that state has a bigger
    // problem than its seat count.
    if (!keep) continue

    await pool.query(
      'UPDATE Memberships SET isActive = false WHERE companyId = $1 AND isActive = true AND id != $2',
      [company.id, keep.id]
    )
    await pool.query('UPDATE Companies SET overLimitLockedOut = true WHERE id = $1', [company.id])

    notifyLockout(company.id, keep, company.name, company.maxusers)
  }
}

function notifyLockout(companyId, keptMembership, companyName, maxUsers) {
  getNotificationRecipients(companyId).then(({ cc }) => {
    sendEmail(
      keptMembership.email,
      `${companyName}'s extra users have been deactivated`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">${companyName}'s extra users have been deactivated</h1>
          <p>Hi ${keptMembership.name},</p>
          <p><strong>${companyName}</strong> was over its plan's limit of <strong>${maxUsers} users</strong> for ${GRACE_PERIOD_WORKING_DAYS} working days, so the extra users have been deactivated to bring it back within plan.</p>
          <p>You still have full access as the remaining active superadmin. From here you can:</p>
          <ul>
            <li>Leave things as they are — you're back within your plan</li>
            <li>Contact your platform administrator to buy more licenses, then reactivate whoever you need from User Management</li>
          </ul>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      cc
    )
  }).catch(err => console.error('Failed to send lockout notification:', err.message))
}

module.exports = { checkAndTrackOverLimit, enforceExpiredGracePeriods }
