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
const { getSupplierCategories, supplierCanSeeCategory } = require('./suppliers')

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

// Same company check as above, plus a supplier may only reach tickets
// in their own categories (see utils/suppliers.js). Routes acting on a
// ticket's comments or attachments use these rather than the
// company-only checks, so a supplier can't read a ticket outside their
// categories just by guessing its id.
async function canAccessTicket(pool, ticketId, user) {
  const result = await pool.query('SELECT category FROM Tickets WHERE id = $1 AND companyId = $2', [ticketId, user.companyId])
  if (result.rows.length === 0) return false
  const categories = await getSupplierCategories(pool, user)
  return supplierCanSeeCategory(categories, result.rows[0].category)
}

async function canAccessAttachment(pool, attachmentId, user) {
  const result = await pool.query(
    `SELECT t.category FROM TicketAttachments ta JOIN Tickets t ON t.id = ta.ticketId WHERE ta.id = $1 AND t.companyId = $2`,
    [attachmentId, user.companyId]
  )
  if (result.rows.length === 0) return false
  const categories = await getSupplierCategories(pool, user)
  return supplierCanSeeCategory(categories, result.rows[0].category)
}

module.exports = { ticketBelongsToCompany, attachmentBelongsToCompany, commentBelongsToCompany, canAccessTicket, canAccessAttachment }
