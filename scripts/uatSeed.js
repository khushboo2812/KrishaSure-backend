// Fills a UAT database with realistic, fake test data: two companies
// (one internal, one MSP with client organisations), users in every
// role, and tickets in the states you need to test (breached, pending,
// unassigned, resolved...). Safe to run again: anything that already
// exists is left alone.
//
//   APP_ENV=uat UAT_SEED_PASSWORD='...' node scripts/uatSeed.js
//
// It refuses to run unless APP_ENV is 'uat', and refuses if the
// database looks like production (PRODUCTION_DB_HOST).
const bcrypt = require('bcryptjs')
const { IS_UAT } = require('../src/config/env')

function die(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

if (!IS_UAT) die('Refusing to run: APP_ENV must be "uat". This script writes test data.')
if (process.env.PRODUCTION_DB_HOST && String(process.env.SUPABASE_DB_URL || '').includes(process.env.PRODUCTION_DB_HOST)) {
  die('Refusing to run: SUPABASE_DB_URL points at the production database.')
}
const PASSWORD = process.env.UAT_SEED_PASSWORD
if (!PASSWORD || PASSWORD.length < 10) die('Set UAT_SEED_PASSWORD (at least 10 characters). Every test account gets this password.')

const { pool } = require('../src/config/db')
const { seedDefaultLevels } = require('../src/utils/agentLevels')
const { generateSupportEmail } = require('../src/utils/supportEmail')
const { generateTicketId } = require('../src/utils/ticketId')

// Test accounts have fake addresses (nothing can be delivered to them,
// and UAT drops mail to anyone not on the allow-list anyway). Set
// UAT_SEED_TESTER_EMAIL to a real mailbox of yours and each account
// becomes a "plus address" of it (you+admin@gmail.com), so notification
// emails for every test user land in YOUR inbox.
const TESTER = process.env.UAT_SEED_TESTER_EMAIL
const address = (tag) => {
  if (!TESTER) return `${tag}@uat.krishasure.test`
  const [local, domain] = TESTER.split('@')
  return `${local}+${tag}@${domain}`
}

const credentials = []

async function ensureCompany({ name, companyType }) {
  const existing = await pool.query('SELECT id FROM Companies WHERE name = $1', [name])
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false }
  const supportEmail = await generateSupportEmail(pool, name)
  const inserted = await pool.query(
    'INSERT INTO Companies (name, tier, databaseType, companyType, supportEmail) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, 'starter', 'shared', companyType, supportEmail]
  )
  const id = inserted.rows[0].id
  await pool.query('INSERT INTO SLARules (priority, categoryId, maxHours, companyId) VALUES ($1, NULL, 2, $5), ($2, NULL, 8, $5), ($3, NULL, 24, $5), ($4, NULL, 72, $5)', ['Urgent', 'High', 'Medium', 'Low', id])
  await seedDefaultLevels(id)
  // Escalation on, and a small AI allowance (the AI provider's free tier is tiny).
  await pool.query('UPDATE Companies SET escalationEnabled = true, aiEnabled = true, maxAiRequestsPerMonth = 50 WHERE id = $1', [id])
  return { id, created: true }
}

async function ensureCategory(companyId, name, description) {
  const existing = await pool.query('SELECT id FROM Categories WHERE companyId = $1 AND name = $2', [companyId, name])
  if (existing.rows.length === 0) {
    await pool.query('INSERT INTO Categories (name, description, companyId) VALUES ($1, $2, $3)', [name, description, companyId])
  }
}

async function ensureClientOrg(companyId, org) {
  const existing = await pool.query('SELECT id FROM ClientOrganizations WHERE companyId = $1 AND name = $2', [companyId, org.name])
  if (existing.rows.length > 0) return existing.rows[0].id
  const supportEmail = await generateSupportEmail(pool, org.name)
  const inserted = await pool.query(
    `INSERT INTO ClientOrganizations (name, companyId, hasHoursContract, contractedHours, resetCadence, overtimeHandling, contractEndDate, currentPeriodStart, supportEmail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [org.name, companyId, !!org.contractedHours, org.contractedHours || null, org.contractedHours ? 'Monthly' : null,
     org.contractedHours ? 'Settle separately' : null,
     org.contractedHours ? new Date(Date.now() + 365 * 24 * 3600 * 1000) : null,
     org.contractedHours ? new Date() : null, supportEmail]
  )
  return inserted.rows[0].id
}

// One person, one membership per company. role: platform_owner,
// superadmin, agent, supplier or client. Agents and suppliers also get
// an Agents row (level + skills), exactly as the Add User screen does.
async function ensureUser({ tag, name, companyId, role, clientOrgId = null, level = 'Junior', skills = '' }) {
  const email = address(tag)
  let person = (await pool.query('SELECT id FROM People WHERE LOWER(email) = LOWER($1)', [email])).rows[0]
  if (!person) {
    const hash = await bcrypt.hash(PASSWORD, 10)
    person = (await pool.query(
      'INSERT INTO People (name, email, password, mustChangePassword, emailVerified) VALUES ($1, $2, $3, false, true) RETURNING id',
      [name, email, hash]
    )).rows[0]
  }
  const membership = await pool.query('SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2', [person.id, companyId])
  if (membership.rows.length === 0) {
    await pool.query('INSERT INTO Memberships (personId, companyId, role, clientOrgId) VALUES ($1, $2, $3, $4)', [person.id, companyId, role, clientOrgId])
  }
  if (role === 'agent' || role === 'supplier') {
    const agent = await pool.query('SELECT id FROM Agents WHERE LOWER(email) = LOWER($1) AND companyId = $2', [email, companyId])
    if (agent.rows.length === 0) {
      await pool.query('INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)', [name, email, level, skills, companyId])
    }
  }
  credentials.push({ role, name, email })
  return email
}

async function seedTickets(companyId, tickets) {
  const existing = await pool.query("SELECT COUNT(*) FROM Tickets WHERE companyId = $1 AND title LIKE '[UAT seed]%'", [companyId])
  if (parseInt(existing.rows[0].count, 10) > 0) return 0
  for (const t of tickets) {
    const ticketId = await generateTicketId(pool)
    await pool.query(
      `INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId, status, createdAt, pendingSince, resolvedAt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - ($11 || ' hours')::interval, ${t.pendingHours ? "NOW() - ($12 || ' hours')::interval" : 'NULL'}, ${t.status === 'Resolved' ? "NOW() - INTERVAL '12 hours'" : 'NULL'})`,
      [ticketId, `[UAT seed] ${t.title}`, t.description, t.category, t.priority, t.assignedTo || null, t.clientEmail, companyId, t.clientOrgId || null, t.status, String(t.ageHours),
       ...(t.pendingHours ? [String(t.pendingHours)] : [])]
    )
  }
  return tickets.length
}

async function main() {
  // --- Platform (the platform owner needs a home company) -------------------
  const platform = await ensureCompany({ name: 'KrishaSure UAT Platform', companyType: 'internal' })
  await ensureUser({ tag: 'platform-owner', name: 'UAT Platform Owner', companyId: platform.id, role: 'platform_owner' })

  // --- Internal company -----------------------------------------------------
  const internal = await ensureCompany({ name: 'UAT Internal Co', companyType: 'internal' })
  await ensureCategory(internal.id, 'Hardware', 'Laptops, printers and other equipment')
  await ensureUser({ tag: 'internal-admin', name: 'Ina Admin', companyId: internal.id, role: 'superadmin' })
  await ensureUser({ tag: 'internal-agent', name: 'Ian Agent', companyId: internal.id, role: 'agent', level: 'Junior', skills: 'General,Hardware' })
  await ensureUser({ tag: 'internal-client', name: 'Ivy Employee', companyId: internal.id, role: 'client' })

  // --- MSP company ----------------------------------------------------------
  const msp = await ensureCompany({ name: 'UAT MSP Demo', companyType: 'msp' })
  for (const [name, description] of [
    ['Hardware', 'Laptops, printers and other equipment'],
    ['Network', 'WiFi, VPN, internet and connectivity problems'],
    ['ERP', 'Problems with the ERP system: access, posting errors, reports']
  ]) await ensureCategory(msp.id, name, description)

  const clientOne = await ensureClientOrg(msp.id, { name: 'UAT Client One (hours contract)', contractedHours: 40 })
  const clientTwo = await ensureClientOrg(msp.id, { name: 'UAT Client Two (no contract)' })

  const admin = await ensureUser({ tag: 'msp-admin', name: 'Mia Admin', companyId: msp.id, role: 'superadmin' })
  const junior = await ensureUser({ tag: 'msp-junior', name: 'Jon Junior', companyId: msp.id, role: 'agent', level: 'Junior', skills: 'General,Hardware,Network' })
  await ensureUser({ tag: 'msp-senior', name: 'Sara Senior', companyId: msp.id, role: 'agent', level: 'Senior', skills: 'General,Hardware,Network,ERP' })
  await ensureUser({ tag: 'msp-supplier', name: 'Sam Supplier', companyId: msp.id, role: 'supplier', skills: 'ERP' })
  const client1 = await ensureUser({ tag: 'msp-client-one', name: 'Cleo One', companyId: msp.id, role: 'client', clientOrgId: clientOne })
  const client2 = await ensureUser({ tag: 'msp-client-two', name: 'Cal Two', companyId: msp.id, role: 'client', clientOrgId: clientTwo })
  // One person with access to two companies, to test the company picker at login.
  await ensureUser({ tag: 'multi', name: 'Max Both', companyId: internal.id, role: 'superadmin' })
  await ensureUser({ tag: 'multi', name: 'Max Both', companyId: msp.id, role: 'agent', level: 'Senior', skills: 'General,Network' })

  const created = await seedTickets(msp.id, [
    { title: 'Printer offline (fresh, within SLA)', description: 'The office printer shows offline.', category: 'Hardware', priority: 'Low', assignedTo: 'Jon Junior', clientEmail: client1, clientOrgId: clientOne, status: 'Open/Assigned', ageHours: 1 },
    { title: 'VPN drops every hour (breached: escalates to Sara Senior within the hour)', description: 'The VPN disconnects roughly every hour.', category: 'Network', priority: 'Medium', assignedTo: 'Jon Junior', clientEmail: client1, clientOrgId: clientOne, status: 'Open/Assigned', ageHours: 120 },
    { title: 'Waiting on the client for screenshots (Pending, reminder due)', description: 'Needs a screenshot of the error.', category: 'General', priority: 'Medium', assignedTo: 'Jon Junior', clientEmail: client2, clientOrgId: clientTwo, status: 'Pending', ageHours: 100, pendingHours: 96 },
    { title: 'New starter needs a laptop (unassigned)', description: 'Please order and configure a laptop.', category: 'Hardware', priority: 'Low', clientEmail: client2, clientOrgId: clientTwo, status: 'Open/Unassigned', ageHours: 6 },
    { title: 'Cannot post invoices in the ERP (with the supplier)', description: 'Posting fails with a validation error.', category: 'ERP', priority: 'High', assignedTo: 'Sam Supplier', clientEmail: client1, clientOrgId: clientOne, status: 'Open/Assigned', ageHours: 3 },
    { title: 'Reset password (resolved yesterday)', description: 'Password reset requested.', category: 'General', priority: 'Low', assignedTo: 'Jon Junior', clientEmail: client2, clientOrgId: clientTwo, status: 'Resolved', ageHours: 30 }
  ])

  console.log(`\nSeed complete. Tickets added: ${created}${created === 0 ? ' (already seeded)' : ''}.`)
  console.log(`Every account below has the password you set in UAT_SEED_PASSWORD.\n`)
  const seen = new Set()
  for (const c of credentials) {
    const key = `${c.email}|${c.role}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`  ${c.role.padEnd(15)} ${c.name.padEnd(20)} ${c.email}`)
  }
  console.log(`\nMSP support address: ${(await pool.query('SELECT supportEmail FROM Companies WHERE id = $1', [msp.id])).rows[0].supportemail}`)
  await pool.end()
}

main().catch(err => { console.error('Seed failed:', err.message); process.exit(1) })
