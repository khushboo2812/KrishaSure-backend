// A client's in-app comment on a resolved ticket reopens it (within 14
// days); staff comments and old tickets don't.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let ticket
const reopenCalls = []
const fakePool = {
  query: async (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (/^INSERT INTO TicketComments/i.test(q)) return { rows: [] }
    if (/^SELECT \* FROM Tickets WHERE id/i.test(q)) return { rows: [ticket] }
    throw new Error('unexpected query: ' + q)
  }
}
const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports }
}
stub('../config/db', { pool: fakePool })
stub('../config/email', { sendEmail: () => {} })
stub('../middleware/auth', { authenticateToken: (req, res, next) => next() })
stub('../utils/commentNotifications', { notifyNewComment: async () => {} })
stub('../utils/pendingTickets', { resumeFromPending: async () => false })
stub('../utils/ticketAccess', { canAccessTicket: async () => true, commentBelongsToCompany: async () => true })
const reopenPath = require.resolve('../utils/reopenTicket')
const real = require('../utils/reopenTicket')
require.cache[reopenPath] = { id: reopenPath, filename: reopenPath, loaded: true, exports: { ...real, reopenTicket: async (t, o) => { reopenCalls.push(o.byName); return true } } }
const router = require('./comments')

const handler = router.stack.find(l => l.route && l.route.path === '/:ticketId' && l.route.methods.post).route.stack.at(-1).handle

async function post(role) {
  return new Promise(resolve => {
    const req = { params: { ticketId: '5' }, body: { comment: 'still broken' }, user: { name: 'Cora', email: 'c@x.com', role } }
    const res = { status() { return this }, json: body => resolve(body) }
    handler(req, res)
  })
}
const daysAgo = n => new Date(Date.now() - n * 86400000)

test('a client commenting on a recently resolved ticket reopens it', async () => {
  reopenCalls.length = 0
  ticket = { id: 5, status: 'Resolved', resolvedat: daysAgo(3) }
  const out = await post('client')
  assert.equal(out.reopened, true)
  assert.deepEqual(reopenCalls, ['Cora'])
})

test('a client commenting after 14 days keeps the comment but not the reopen', async () => {
  reopenCalls.length = 0
  ticket = { id: 5, status: 'Resolved', resolvedat: daysAgo(20) }
  const out = await post('client')
  assert.equal(out.reopened, false)
  assert.equal(out.reopenExpired, true)
  assert.equal(reopenCalls.length, 0)
})

test('staff commenting on a resolved ticket does not reopen it', async () => {
  reopenCalls.length = 0
  ticket = { id: 5, status: 'Resolved', resolvedat: daysAgo(1) }
  const out = await post('agent')
  assert.equal(out.reopened, false)
  assert.equal(reopenCalls.length, 0)
})

test('a client commenting on an open ticket changes nothing', async () => {
  reopenCalls.length = 0
  ticket = { id: 5, status: 'Open/Assigned', resolvedat: null }
  const out = await post('client')
  assert.equal(out.reopened, false)
  assert.equal(out.reopenExpired, false)
  assert.equal(reopenCalls.length, 0)
})
