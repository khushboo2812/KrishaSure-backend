// Shared logic for whether a client org's hours contract is currently in
// force, and for lazily rolling currentPeriodStart forward once its
// resetCadence period has elapsed. There's no scheduled/cron job in this
// backend, so rollover is computed on read (same pattern hours-balance
// already uses to derive usage live from HoursLog instead of caching it).

const CADENCE_MONTHS = { Monthly: 1, Quarterly: 3, Annually: 12 }

function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

// A contract only applies while hasHoursContract is set AND (there's no
// contractEndDate, or that date hasn't passed yet). Once expired, callers
// should treat the org exactly like one with no contract at all.
function isContractActive(org, now = new Date()) {
  if (!org.hashourscontract) return false
  if (org.contractenddate && new Date(org.contractenddate) < now) return false
  return true
}

// Advances currentPeriodStart past any fully-elapsed resetCadence periods,
// applying overtimeHandling at each boundary crossed:
//   - "Roll over": the period's overage becomes a debit against the next
//     period's allowance (contractedHours - carriedOverHours), and
//     whatever is still over after that becomes the new carried amount.
//   - anything else ("Settle separately"): carriedOverHours resets to 0 —
//     the new period starts clean regardless of prior overage.
// Persists the update and returns the (possibly updated) org row. Only
// call this for orgs that are currently under an active contract — an
// unknown/missing resetCadence, or no currentPeriodStart yet, is a no-op.
async function advancePeriodIfDue(pool, org, now = new Date()) {
  const cadenceMonths = CADENCE_MONTHS[org.resetcadence]
  if (!cadenceMonths || !org.currentperiodstart) return org

  let periodStart = new Date(org.currentperiodstart)
  let carriedOverHours = parseFloat(org.carriedoverhours || 0)
  const contractedHours = parseFloat(org.contractedhours) || 0
  let advanced = false

  while (true) {
    const periodEnd = addMonths(periodStart, cadenceMonths)
    if (now < periodEnd) break

    const usedResult = await pool.query(
      `SELECT COALESCE(SUM(h.hoursSpent), 0) as totalUsed
       FROM HoursLog h
       JOIN Tickets t ON h.ticketId = t.id
       WHERE t.clientOrgId = $1 AND h.loggedAt >= $2 AND h.loggedAt < $3`,
      [org.id, periodStart, periodEnd]
    )
    const usedThisPeriod = parseFloat(usedResult.rows[0].totalused)
    const allowanceThisPeriod = contractedHours - carriedOverHours
    const overage = Math.max(0, usedThisPeriod - allowanceThisPeriod)

    carriedOverHours = org.overtimehandling === 'Roll over' ? overage : 0
    periodStart = periodEnd
    advanced = true
  }

  if (!advanced) return org

  await pool.query(
    'UPDATE ClientOrganizations SET currentPeriodStart = $1, carriedOverHours = $2 WHERE id = $3',
    [periodStart, carriedOverHours, org.id]
  )

  return { ...org, currentperiodstart: periodStart, carriedoverhours: carriedOverHours }
}

module.exports = { isContractActive, advancePeriodIfDue }
