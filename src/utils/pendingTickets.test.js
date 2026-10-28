// Runs the hourly Pending follow-up job against a fake database: each
// company's own reminder/auto-close days decide what happens to its
// tickets, and a company with a step switched off never gets it.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const companies = new Map()
let tickets = []
const resolved = []
const reminded = []
const sent = []

const fakePool = {
  query: async (sql, params) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (/^SELECT \* FROM Tickets WHERE status = 'Pending'/i.test(q)) return { rows: tickets }
    if (/^SELECT pendingReminderDays, pendingAutoCloseDays FROM Companies/i.test(q)) {
      const c = companies.get(params[0])
      return { rows: c ? [{ pendingreminderdays: c.reminder, pendingautoclosedays: c.close }] : [] }
    }
    if (/^SELECT supportEmail FROM Companies/i.test(q)) return { rows: [] }
    if (/^SELECT businessDays/i.test(q)) return { rows: [] }
    if (/^SELECT email FROM Agents/i.test(q)) return { rows: [] }
    if (/^UPDATE Tickets SET status = 'Resolved'/i.test(q)) { resolved.push(params[1]); return { rowCount: 1, rows: [] } }
    if (/^UPDATE Tickets SET pendingReminderSentAt = NOW\(\)/i.test(q)) { reminded.push(params[0]); return { rowCount: 1, rows: [] } }
    if (/^INSERT INTO TicketHistory/i.test(q)) return { rows: [] }
    throw new Error('unexpected query: ' + q)
  }
}
const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}
stub('../config/db', { pool: fakePool })
stub('../config/email', { sendEmail: (to, subject) => { sent.push({ to, subject }) } })
const { runPendingFollowUps } = require('./pendingTickets')

// Monday 6 Jan 2025 → "now" is 12 working days later (Wed 22 Jan).
const pendingSince = new Date('2025-01-06T09:00:00Z')
const now = new Date('2025-01-22T09:00:00Z')

function ticket(id, companyid) {
  return { id, ticketid: `TKT-${id}`, title: 't', companyid, clientemail: 'c@x.com', status: 'Pending', pendingsince: pendingSince, createdat: pendingSince, pendingremindersentat: null }
}
function reset() { resolved.length = 0; reminded.length = 0; sent.length = 0 }

test('a company on the defaults closes a long-waiting ticket', async () => {
  reset()
  companies.set(1, { reminder: 3, close: 5 })
  tickets = [ticket(10, 1)]
  await runPendingFollowUps(now)
  assert.deepEqual(resolved, [10])
  assert.match(sent[0].subject, /closed/)
})

test('a company with a 14-day close leaves a 12-day-old ticket alone, and reminds', async () => {
  reset()
  companies.set(2, { reminder: 7, close: 14 })
  tickets = [ticket(20, 2)]
  await runPendingFollowUps(now)
  assert.deepEqual(resolved, [])
  assert.deepEqual(reminded, [20])
  assert.match(sent[0].subject, /Reminder/)
})

test('each company is judged on its own numbers in the same run', async () => {
  reset()
  companies.set(1, { reminder: 3, close: 5 })
  companies.set(2, { reminder: 7, close: 14 })
  tickets = [ticket(10, 1), ticket(20, 2)]
  await runPendingFollowUps(now)
  assert.deepEqual(resolved, [10])
  assert.deepEqual(reminded, [20])
})

test('a company that never auto-closes keeps the ticket open', async () => {
  reset()
  companies.set(3, { reminder: null, close: null })
  tickets = [ticket(30, 3)]
  await runPendingFollowUps(now)
  assert.deepEqual(resolved, [])
  assert.deepEqual(reminded, [])
  assert.equal(sent.length, 0)
})
