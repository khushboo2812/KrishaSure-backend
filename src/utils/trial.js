// A company's free trial: a fixed number of days from when it starts,
// stored as Companies.trialEndsAt (see sql/add_company_free_trial.sql).
// NULL means "not on a trial" — an ordinary paying company, which is
// what every company created before trials existed is.
//
// Kept free of database access so the rules are easy to test; the
// routes and the login/session checks call these with the stored value.
const TRIAL_DAYS = 15
const DEFAULT_EXTENSION_DAYS = 7
const MAX_EXTENSION_DAYS = 60
const REMINDER_DAYS_BEFORE_END = 3
const DAY_MS = 24 * 60 * 60 * 1000

const TRIAL_ENDED_MESSAGE = 'Your free trial has ended — contact your platform administrator to continue'

function addDays(from, days) {
  return new Date(new Date(from).getTime() + days * DAY_MS)
}

function isTrialExpired(trialEndsAt, now = new Date()) {
  if (!trialEndsAt) return false
  return new Date(trialEndsAt).getTime() <= new Date(now).getTime()
}

// Whole days remaining, rounded up so "ends later today" reads as 1
// day left rather than 0. Null when not on a trial; 0 once it has ended.
function trialDaysLeft(trialEndsAt, now = new Date()) {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - new Date(now).getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
}

// What a trial change does to the end date. start: a fresh full trial
// from now. extend: more days on top of the current end — or on top of
// today if it has already ended, so extending never lands in the past.
// convert: the client is now paying, so there is no trial any more.
function nextTrialEnd(action, current, days, now = new Date()) {
  if (action === 'start') return { trialEndsAt: addDays(now, TRIAL_DAYS) }
  if (action === 'convert') return { trialEndsAt: null }
  if (action === 'extend') {
    const n = days == null || days === '' ? DEFAULT_EXTENSION_DAYS : Number(days)
    if (!Number.isInteger(n) || n < 1 || n > MAX_EXTENSION_DAYS) {
      return { error: `Extend by a whole number of days between 1 and ${MAX_EXTENSION_DAYS}.` }
    }
    const base = current && !isTrialExpired(current, now) ? current : now
    return { trialEndsAt: addDays(base, n) }
  }
  return { error: 'Unknown trial action.' }
}

module.exports = {
  TRIAL_DAYS, DEFAULT_EXTENSION_DAYS, MAX_EXTENSION_DAYS, REMINDER_DAYS_BEFORE_END,
  TRIAL_ENDED_MESSAGE, addDays, isTrialExpired, trialDaysLeft, nextTrialEnd
}
