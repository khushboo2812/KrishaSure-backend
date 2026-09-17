// Computes elapsed time between two instants counting only a
// company's configured business hours (working days + a start/end
// time-of-day, in a given IANA timezone) — used so SLA breach
// detection and "time open" don't count nights and weekends.
//
// No date library: this repo doesn't have one, and the technique below
// (format a UTC instant into local wall-clock parts via Intl, then
// invert that with a 2-pass fixed-point correction) is standard and
// correctly handles DST transitions without one.

const DAY_MS = 24 * 60 * 60 * 1000

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short'
  }).formatToParts(date)
  const get = type => parts.find(p => p.type === type).value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday')
  }
}

// Inverse of getZonedParts: the UTC instant whose wall-clock time in
// `timeZone` reads as year-month-day hour:minute. Two passes is enough
// — a timezone's UTC offset never shifts by more than the DST delta
// (at most ~2h) between the initial guess and the corrected instant,
// so the second pass's residual error is always 0.
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = new Date(wantedAsUtc)
  for (let i = 0; i < 2; i++) {
    const p = getZonedParts(guess, timeZone)
    const guessedLocalAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess = new Date(guess.getTime() + (wantedAsUtc - guessedLocalAsUtc))
  }
  return guess
}

// businessHours: { businessDays: 'Mon,Tue,Wed,Thu,Fri', businessHoursStart: '09:00', businessHoursEnd: '17:00', timezone: 'UTC' }
function businessMillisecondsElapsed(start, end, businessHours) {
  if (!(end > start)) return 0

  const businessDaySet = new Set((businessHours?.businessDays || 'Mon,Tue,Wed,Thu,Fri').split(',').map(d => d.trim()))
  const [startH, startM] = (businessHours?.businessHoursStart || '09:00').split(':').map(Number)
  const [endH, endM] = (businessHours?.businessHoursEnd || '17:00').split(':').map(Number)
  const timeZone = businessHours?.timezone || 'UTC'

  let total = 0
  let cursorParts = getZonedParts(start, timeZone)
  const endParts = getZonedParts(end, timeZone)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const dayOpen = zonedTimeToUtc(cursorParts.year, cursorParts.month, cursorParts.day, startH, startM, timeZone)
    const dayClose = zonedTimeToUtc(cursorParts.year, cursorParts.month, cursorParts.day, endH, endM, timeZone)

    if (businessDaySet.has(cursorParts.weekday)) {
      const windowStart = dayOpen < start ? start : dayOpen
      const windowEnd = dayClose > end ? end : dayClose
      if (windowEnd > windowStart) total += windowEnd - windowStart
    }

    const isLastDay = cursorParts.year === endParts.year && cursorParts.month === endParts.month && cursorParts.day === endParts.day
    if (isLastDay) break

    // Advance one local calendar day, anchored at local noon (safely
    // clear of any DST transition, which never happens midday) so the
    // next iteration lands on the correct next date regardless of zone.
    const noonThisDay = zonedTimeToUtc(cursorParts.year, cursorParts.month, cursorParts.day, 12, 0, timeZone)
    cursorParts = getZonedParts(new Date(noonThisDay.getTime() + DAY_MS), timeZone)
  }

  return total
}

function businessHoursElapsed(start, end, businessHours) {
  return businessMillisecondsElapsed(new Date(start), new Date(end), businessHours) / (60 * 60 * 1000)
}

// A client org can optionally override its company's business hours
// (e.g. it's in a different timezone, or negotiated different support
// hours) — set together, all four fields or none, by the settings
// endpoint in routes/clientOrgs.js. businessDays is the "configured"
// signal: null means no override, fall back to the company's hours.
function getEffectiveBusinessHours(companyBusinessHours, clientOrgBusinessHours) {
  if (clientOrgBusinessHours && clientOrgBusinessHours.businessDays) return clientOrgBusinessHours
  return companyBusinessHours
}

module.exports = { businessMillisecondsElapsed, businessHoursElapsed, getEffectiveBusinessHours, getZonedParts, zonedTimeToUtc }
