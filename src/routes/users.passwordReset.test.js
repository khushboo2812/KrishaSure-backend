// Calls the PUT /:id/password handler directly with a fake database.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const bcrypt = require('bcryptjs')

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key'
const updates = []
const fakePool = {
  query: async (sql, params) => {
    const q = sql.trim()
    if (/^SELECT id FROM Memberships WHERE personId = \$1 AND companyId = \$2/i.test(q)) {
      return { rows: String(params[0]) === '99' ? [] : [{ id: 1 }] }
    }
    if (/^UPDATE People SET password = \$1, mustChangePassword = \$2/i.test(q)) { updates.push(params); return { rows: [] } }
    throw new Error('unexpected query: ' + q.slice(0, 80))
  }
}
const dbPath = require.resolve(path.join(__dirname, '../config/db'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: fakePool, connectDB: async () => {} } }
const router = require('./users')

const layer = router.stack.find(l => l.route && l.route.path === '/:id/password' && l.route.methods.put)
const handler = layer.route.stack[layer.route.stack.length - 1].handle
async function call(id, password, user) {
  const out = { status: 200, body: null }
  const res = { status(c) { out.status = c; return this }, json(b) { out.body = b; return this } }
  await handler({ params: { id }, body: { password }, user }, res)
  return out
}
const admin = { personId: 1, companyId: 5, role: 'superadmin' }

test('an admin setting someone else\'s password makes it temporary', async () => {
  updates.length = 0
  const r = await call('42', 'chosen-by-admin', admin)
  assert.equal(r.status, 200); assert.equal(updates.length, 1)
  assert.ok(await bcrypt.compare('chosen-by-admin', updates[0][0]))
  assert.equal(updates[0][1], true); assert.equal(updates[0][2], '42')
})

test('changing your own password is final, not temporary', async () => {
  updates.length = 0
  const r = await call('1', 'my-own-new-pass', admin)
  assert.equal(r.status, 200); assert.equal(updates[0][1], false)
})

test('a platform owner resetting someone else\'s also makes it temporary', async () => {
  updates.length = 0
  await call('42', 'platform-chosen', { personId: 2, companyId: 5, role: 'platform_owner' })
  assert.equal(updates[0][1], true)
})

test('still refused: too short, not an admin, or not in the admin\'s company', async () => {
  updates.length = 0
  assert.equal((await call('42', 'abc', admin)).status, 400)
  assert.equal((await call('42', 'long-enough', { personId: 1, companyId: 5, role: 'agent' })).status, 403)
  assert.equal((await call('99', 'long-enough', admin)).status, 404)
  assert.equal(updates.length, 0)
})
