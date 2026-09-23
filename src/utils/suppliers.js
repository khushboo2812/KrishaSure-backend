// Suppliers are outside vendors who support one of a company's systems.
// They hold an Agents row like an agent (so tickets can be assigned to
// them), but their Agents.skills is also a hard boundary: a supplier
// only ever sees, or is assigned, tickets whose category is in it.

function parseCategories(skills) {
  return (skills || '').split(',').map(s => s.trim()).filter(Boolean)
}

// The categories the calling user is limited to, or null when they're
// not a supplier (no limit). A supplier with no Agents row, or no
// categories set, gets [] — sees nothing — rather than everything.
async function getSupplierCategories(pool, user) {
  if (user.role !== 'supplier') return null
  const result = await pool.query('SELECT skills FROM Agents WHERE LOWER(email) = LOWER($1) AND companyId = $2', [user.email, user.companyId])
  return parseCategories(result.rows[0]?.skills)
}

function supplierCanSeeCategory(categories, category) {
  return categories === null || categories.includes(category)
}

// Whether the agent named `agentName` in this company is a supplier,
// and if so which categories they cover. Used before a ticket is handed
// to someone, so a supplier never ends up holding a ticket they can't see.
async function getAssigneeSupplierCategories(pool, agentName, companyId) {
  if (!agentName) return null
  const result = await pool.query(
    `SELECT a.skills, m.role FROM Agents a
     JOIN People p ON LOWER(p.email) = LOWER(a.email)
     JOIN Memberships m ON m.personId = p.id AND m.companyId = a.companyId
     WHERE a.name = $1 AND a.companyId = $2`,
    [agentName, companyId]
  )
  const row = result.rows[0]
  if (!row || row.role !== 'supplier') return null
  return parseCategories(row.skills)
}

// Clients only ever reach tickets they raised themselves — matching
// what the app shows them. Without this, any client could fetch every
// ticket in the company (including an MSP's other clients' tickets)
// straight from the API.
function clientCanSeeTicket(user, ticket) {
  return user.role !== 'client' || (ticket.clientemail || '').toLowerCase() === (user.email || '').toLowerCase()
}

// One check for "can this user reach this ticket at all", beyond it
// being in their company: suppliers are limited to their categories,
// clients to their own tickets.
async function userCanSeeTicket(pool, user, ticket) {
  if (!clientCanSeeTicket(user, ticket)) return false
  const categories = await getSupplierCategories(pool, user)
  return supplierCanSeeCategory(categories, ticket.category)
}

module.exports = { parseCategories, getSupplierCategories, supplierCanSeeCategory, getAssigneeSupplierCategories, clientCanSeeTicket, userCanSeeTicket }
