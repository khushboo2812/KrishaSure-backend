// Shared by routes/businessHours.js (company-level) and routes/
// clientOrgs.js (the optional per-client-org override) — same rules,
// same error messages, so a malformed config can't slip through
// either PUT and silently break every SLA calculation in the app.

const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Returns { error } on invalid input, or { businessDays, businessHoursStart, businessHoursEnd, timezone } normalized and ready to persist.
function validateBusinessHoursInput({ businessDays, businessHoursStart, businessHoursEnd, timezone }) {
  const days = (businessDays || '').split(',').map(d => d.trim()).filter(Boolean)
  if (days.length === 0 || !days.every(d => VALID_DAYS.has(d))) {
    return { error: 'businessDays must be a comma-separated list of Mon/Tue/Wed/Thu/Fri/Sat/Sun' }
  }
  if (!TIME_RE.test(businessHoursStart) || !TIME_RE.test(businessHoursEnd)) {
    return { error: 'businessHoursStart/End must be in HH:MM 24-hour format' }
  }
  if (toMinutes(businessHoursStart) >= toMinutes(businessHoursEnd)) {
    return { error: 'businessHoursStart must be earlier than businessHoursEnd' }
  }
  if (!timezone || !isValidTimezone(timezone)) {
    return { error: 'timezone must be a valid IANA timezone name (e.g. America/New_York)' }
  }
  return { businessDays: days.join(','), businessHoursStart, businessHoursEnd, timezone }
}

module.exports = { validateBusinessHoursInput }
