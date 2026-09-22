// How many Mon-Fri calendar days have fully passed between `start` and
// `end` — used for the 30-working-day grace period a company gets
// after being lowered below its current active user count (see
// overLimitTracking.js). Deliberately coarse (calendar weekdays, no
// public holidays) — the same "working days" a person would count on
// their fingers, not the hour-precise business-hours math the SLA
// timers use.
function workingDaysBetween(start, end) {
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)

  let count = 0
  while (cur < endDay) {
    cur.setDate(cur.getDate() + 1)
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

module.exports = { workingDaysBetween }
