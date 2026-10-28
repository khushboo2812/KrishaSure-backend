// How long a ticket may sit in Pending (waiting on the client) before
// the client is reminded and before it closes itself — set by each
// company (Settings -> Pending tickets), stored on Companies
// (sql/add_pending_ticket_settings.sql). Days are working days
// (Mon-Fri), the same count used everywhere else for Pending.
//
// A blank/null value switches that step off: no reminder, or never
// close automatically. Defaults match what every company had before
// this was configurable.
const DEFAULT_REMINDER_DAYS = 3
const DEFAULT_AUTO_CLOSE_DAYS = 5
const MAX_DAYS = 60

function toDays(value, label) {
  if (value === null || value === '') return { value: null }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    return { error: `${label} must be a whole number of working days from 1 to ${MAX_DAYS}, or switched off.` }
  }
  return { value: n }
}

// Both fields must be sent (null = off) so a partial request can never
// quietly switch one of them off.
function parsePendingSettings(body = {}) {
  if (body.pendingReminderDays === undefined || body.pendingAutoCloseDays === undefined) {
    return { error: 'Send both the reminder days and the auto-close days (use null to switch one off).' }
  }
  const reminder = toDays(body.pendingReminderDays, 'Reminder')
  if (reminder.error) return { error: reminder.error }
  const close = toDays(body.pendingAutoCloseDays, 'Auto-close')
  if (close.error) return { error: close.error }
  if (reminder.value != null && close.value != null && reminder.value >= close.value) {
    return { error: 'The reminder has to come before the ticket closes: pick fewer reminder days than auto-close days.' }
  }
  return { pendingReminderDays: reminder.value, pendingAutoCloseDays: close.value }
}

// What the hourly job does for a Pending ticket that has waited
// `waited` working days. Closing wins over a reminder that is also due.
function pendingAction(waited, { reminderDays, closeDays }, reminderAlreadySent) {
  if (closeDays != null && waited >= closeDays) return 'close'
  if (reminderDays != null && waited >= reminderDays && !reminderAlreadySent) return 'remind'
  return null
}

module.exports = { DEFAULT_REMINDER_DAYS, DEFAULT_AUTO_CLOSE_DAYS, MAX_DAYS, parsePendingSettings, pendingAction }
