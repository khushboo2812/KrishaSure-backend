// Tickets.ticketId has a database-wide unique constraint
// (tickets_ticketid_key), so numbering has to be a single global
// sequence — computing the next number scoped per company (as both
// callers of this used to do independently) means "KS-001" is every
// new company's natural first ticket, which collides with whichever
// company already has one.
//
// Takes the true MAX numeric suffix across every row (via a regex
// extraction, so any row whose ticketId doesn't match "KS-<digits>" is
// just ignored rather than breaking the count) instead of trusting the
// single most-recently-inserted row's ticketId to parse cleanly.
async function generateTicketId(pool) {
  const result = await pool.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(ticketId FROM 'KS-(\\d+)') AS INTEGER)), 0) AS maxnum FROM Tickets`
  )
  const nextNum = result.rows[0].maxnum + 1

  return `KS-${String(nextNum).padStart(3, '0')}`
}

module.exports = { generateTicketId }
