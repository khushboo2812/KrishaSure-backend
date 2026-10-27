// Calls the password handlers in routes/users.js directly with a fake
// database and a fake mailer.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const bcrypt = require('bcryptjs')

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key'
const updates = []
const emails = []
const fakePool = {
  query: async (sql, params) => {
    const q = sql.trim()
    if (/^SELECT id FROM Memberships WHERE personId = \$1 AND companyId = \$2/i.test(q)) {
      return { rows: String(params[0]) === '99' ? [] : [{ id: 1 }] }
    }
    if (/^SELECT \* FROM People WHERE id = \$1/i.test(q)) {
      return { rows: String(params[0]) === '77' ? [] : [{ id: Number(params[0]), name: 'Tess Tester', email: 'tess@example.com' }] }
    }
    if (/^UPDATE People SET password = \$1, mustChangePassword = (true|false)/i.test(q)) {
      updates.push({ hash: params[0], id: params[1], mustChange: /mustChangePassword = true/i.test(q) })
      return { rows: [] }
    }
    throw new Error('unexpected query: ' + q.slice(0, 80))
  }
}
const set = (rel, exports) => { const p = require.resolve(path.join(__dirname, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
set('../config/db', { pool: fakePool, connectDB: async () => {} })
set('../config/email', { sendEmail: (...args) => { emails.push(args) } })
const router = require('./users')

function handlerFor(routePath, method) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  return layer.route.stack[layer.route.stack.length - 1].handle
}
async function call(handler, req) {
  const out = { status: 200, body: null }
  const res = { status(c) { out.status = c; return this }, json(b) { out.body = b; return this } }
  await handler(req, res)
  return out
}
const changePassword = handlerFor('/:id/password', 'put')
const sendReset = handlerFor('/:id/send-password-reset', 'post')
const admin = { personId: 1, companyId: 5, role: 'superadmin' }

test('you can change your own password, and it is final', async () => {
  updates.length = 0
  const r = await call(changePassword, { params: { id: '1' }, body: { password: 'my-own-new-pass' }, user: admin })
  assert.equal(r.status, 200); assert.equal(updates.length, 1)
  assert.ok(await bcrypt.compare('my-own-new-pass', updates[0].hash)); assert.equal(updates[0].mustChange, false)
})

test('nobody, admin or not, can type a password for someone else', async () => {
  updates.length = 0
  for (const user of [admin, { personId: 2, companyId: 5, role: 'platform_owner' }, { personId: 3, companyId: 5, role: 'agent' }]) {
    const r = await call(changePassword, { params: { id: '42' }, body: { password: 'chosen-by-admin' }, user })
    assert.equal(r.status, 403); assert.match(r.body.error, /only change your own/)
  }
  assert.equal(updates.length, 0)
})

test('a short password is refused', async () => {
  const r = await call(changePassword, { params: { id: '1' }, body: { password: 'abc' }, user: admin })
  assert.equal(r.status, 400)
})

test('an admin can send a reset: a temporary password is emailed to the person and the admin never sees it', async () => {
  updates.length = 0; emails.length = 0
  const r = await call(sendReset, { params: { id: '42' }, body: {}, user: admin })
  assert.equal(r.status, 200); assert.match(r.body.message, /Tess Tester/)
  assert.equal(updates.length, 1); assert.equal(updates[0].mustChange, true); assert.equal(updates[0].id, '42')
  assert.equal(emails.length, 1); assert.equal(emails[0][0], 'tess@example.com')
  const temp = emails[0][2].match(/temporary password:<\/strong> (\S+?)<\/p>/)[1]
  assert.ok(await bcrypt.compare(temp, updates[0].hash))           // the emailed password is the saved one
  assert.ok(!JSON.stringify(r.body).includes(temp))                // and the admin's response does not contain it
})

test('a platform owner can send a reset too', async () => {
  updates.length = 0
  const r = await call(sendReset, { params: { id: '42' }, body: {}, user: { personId: 2, companyId: 5, role: 'platform_owner' } })
  assert.equal(r.status, 200); assert.equal(updates[0].mustChange, true)
})

test('refused for non-admins, for people outside the admin\'s company, and for unknown people', async () => {
  updates.length = 0; emails.length = 0
  assert.equal((await call(sendReset, { params: { id: '42' }, body: {}, user: { personId: 3, companyId: 5, role: 'agent' } })).status, 403)
  assert.equal((await call(sendReset, { params: { id: '99' }, body: {}, user: admin })).status, 404)
  assert.equal((await call(sendReset, { params: { id: '77' }, body: {}, user: admin })).status, 404)
  assert.equal(updates.length, 0); assert.equal(emails.length, 0)
})
