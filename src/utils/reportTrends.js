// Pure helpers for report time-series shaping — no DB/express dependency,
// so this can be unit-tested directly.

const VALID_BUCKETS = ['day', 'week', 'month']
const DEFAULT_DAYS = 90
const MAX_DAYS = 365

// Shared window/bucket parsing for every report, so the same date-range
// control on the frontend drives all of them consistently.
function parseWindow(query, now = new Date()) {
  const daysParsed = parseInt(query.days)
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? Math.min(daysParsed, MAX_DAYS) : DEFAULT_DAYS
  const bucket = VALID_BUCKETS.includes(query.bucket) ? query.bucket : 'day'
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { days, bucket, now, start }
}

// Small shared helper: index rows by their bucket's ISO timestamp.
function indexByBucket(rows, mapValue) {
  const byBucket = {}
  rows.forEach(r => { byBucket[new Date(r.bucket).toISOString()] = mapValue(r) })
  return byBucket
}

// Merges generate_series bucket rows with grouped "created" and
// "resolved" query results into one zero-filled series, keyed by each
// bucket's ISO timestamp so quiet buckets still appear (as zeros) rather
// than being skipped, and slaCompliancePct is null rather than 0 when
// nothing eligible was resolved in that bucket. Used for both the
// company-scoped and platform-wide ticket-trends reports — same shape,
// the only difference is whether the underlying queries filter by
// companyId.
function buildTrendSeries(bucketRows, createdRows, resolvedRows) {
  const createdByBucket = indexByBucket(createdRows, r => parseInt(r.cnt))
  const resolvedByBucket = indexByBucket(resolvedRows, r => ({
    resolved: parseInt(r.resolvedcnt),
    eligible: parseInt(r.eligiblecnt),
    withinSla: parseInt(r.withinslacnt)
  }))

  return bucketRows.map(r => {
    const key = new Date(r.bucket).toISOString()
    const resolvedData = resolvedByBucket[key]
    return {
      date: key,
      ticketsCreated: createdByBucket[key] || 0,
      ticketsResolved: resolvedData ? resolvedData.resolved : 0,
      slaCompliancePct: resolvedData && resolvedData.eligible > 0
        ? (resolvedData.withinSla / resolvedData.eligible) * 100
        : null
    }
  })
}

// Same zero-fill pattern as buildTrendSeries, for the platform-wide
// signups-vs-verifications report.
function buildSignupsSeries(bucketRows, signupRows, verifiedRows) {
  const signupsByBucket = indexByBucket(signupRows, r => parseInt(r.cnt))
  const verifiedByBucket = indexByBucket(verifiedRows, r => parseInt(r.cnt))

  return bucketRows.map(r => {
    const key = new Date(r.bucket).toISOString()
    return {
      date: key,
      signups: signupsByBucket[key] || 0,
      verifications: verifiedByBucket[key] || 0
    }
  })
}

module.exports = { VALID_BUCKETS, parseWindow, buildTrendSeries, buildSignupsSeries }
