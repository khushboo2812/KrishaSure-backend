// Every route scoped by :ticketId or :attachmentId/:commentId (comments,
// attachments) must confirm the parent ticket belongs to the caller's own
// company before reading or writing anything — tickets.js itself already
// does this (WHERE t.id = $1 AND t.companyId = $2), but comments and
// attachments are one level removed from that check and were missing it
// entirely: any authenticated user of any company could read or write
// another company's ticket comments/attachments just by guessing a
// numeric id. 404 (not 403) on failure, matching tickets.js's own
// not-found response, so a caller can't distinguish "wrong company" from
// "doesn't exist."
async function ticketBelongsToCompany(pool, ticketId, companyId) {
  const result = await pool.query('SELECT id FROM Tickets WHERE id = $1 AND companyId = $2', [ticketId, companyId])
  return result.rows.length > 0
}

async function attachmentBelongsToCompany(pool, attachmentId, companyId) {
  const result = await pool.query(
    `SELECT ta.id FROM TicketAttachments ta JOIN Tickets t ON t.id = ta.ticketId WHERE ta.id = $1 AND t.companyId = $2`,
    [attachmentId, companyId]
  )
  return result.rows.length > 0
}

async function commentBelongsToCompany(pool, commentId, companyId) {
  const result = await pool.query(
    `SELECT tc.id FROM TicketComments tc JOIN Tickets t ON t.id = tc.ticketId WHERE tc.id = $1 AND t.companyId = $2`,
    [commentId, companyId]
  )
  return result.rows.length > 0
}

module.exports = { ticketBelongsToCompany, attachmentBelongsToCompany, commentBelongsToCompany }
