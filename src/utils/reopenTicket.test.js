const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const updates = []
const history = []
const sent = []
let rowCount = 1
const fakePool = {
  query: async (sql, params) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (/^UPDATE Tickets SET status = \$2, reopenedAt/i.test(q)) { updates.push(params); return { rowCount } }
    if (/^INSERT INTO TicketHistory/i.test(q)) { history.push(params); return { rows: [] } }
    if (/^SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin'/i.test(q)) return { rows: [{ email: 'admin@x.com' }] }
    if (/^SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE p.name/i.test(q)) return { rows: [{ email: 'agent@x.com' }] }
    if (/^SELECT supportEmail FROM Companies/i.test(q)) return { rows: [{ supportemail: 'help@tickets.x.io' }] }
    throw new Error('unexpected query: ' + q)
  }
}
const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}
stub('../config/db', { pool: fakePool })
stub('../config/email', { sendEmail: (to, subject, html, cc) => { sent.push({ to, subject, cc }) } })
const { reopenEligibility, reopenTicket, sendTooOldToReopen } = require('./reopenTicket')

const now = new Date('2025-02-01T12:00:00Z')
const days = n => new Date(now.getTime() - n * 86400000)
const base = { id: 7, ticketid: 'TKT-7', companyid: 1, clientemail: 'c@x.com', assignedto: 'Ann', status: 'Resolved' }

test('eligibility follows status and the 14-day window', () => {
  assert.equal(reopenEligibility({ ...base, resolvedat: days(1) }, now), 'ok')
  assert.equal(reopenEligibility({ ...base, resolvedat: days(14) }, now), 'ok')
  assert.equal(reopenEligibility({ ...base, resolvedat: days(15) }, now), 'expired')
  assert.equal(reopenEligibility({ ...base, status: 'Open/Assigned', resolvedat: days(1) }, now), 'not_resolved')
  assert.equal(reopenEligibility({ ...base, status: 'Pending', resolvedat: null }, now), 'not_resolved')
})

test('reopening keeps the agent, logs it and emails the client with the team on cc', async () => {
  updates.length = history.length = sent.length = 0; rowCount = 1
  assert.equal(await reopenTicket(base, { byName: 'Carol' }), true)
  assert.deepEqual(updates[0], [7, 'Open/Assigned'])
  assert.deepEqual(history[0], [7, 'Reopened', 'Carol'])
  assert.equal(sent[0].to, 'c@x.com')
  assert.match(sent[0].subject, /Reopened/)
  assert.equal(sent[0].cc, 'agent@x.com,admin@x.com')
})

test('an unassigned ticket goes back to the unassigned queue', async () => {
  updates.length = 0; rowCount = 1
  await reopenTicket({ ...base, assignedto: null }, { byName: 'Carol' })
  assert.equal(updates[0][1], 'Open/Unassigned')
})

test('if it was already reopened by someone else, nothing is logged or sent', async () => {
  updates.length = history.length = sent.length = 0; rowCount = 0
  assert.equal(await reopenTicket(base, { byName: 'Carol' }), false)
  assert.equal(history.length, 0)
  assert.equal(sent.length, 0)
})

test('too-old reply tells the client to raise a new ticket', async () => {
  sent.length = 0
  await sendTooOldToReopen(base)
  assert.equal(sent[0].to, 'c@x.com')
  assert.match(sent[0].subject, /raise a new ticket/)
})
