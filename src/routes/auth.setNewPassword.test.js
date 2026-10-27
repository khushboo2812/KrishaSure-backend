// Calls the /set-new-password handler directly with a fake database, the
// way the other route checks in this project do.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const people = new Map()
const updates = []
const fakePool = {
  query: async (sql, params) => {
    if (/^SELECT id, mustChangePassword FROM People/i.test(sql.trim())) {
      const p = people.get(params[0])
      return { rows: p ? [{ id: p.id, mustchangepassword: p.mustchangepassword }] : [] }
    }
    if (/^UPDATE People SET password/i.test(sql.trim())) { updates.push(params); return { rows: [] } }
    throw new Error('unexpected query: ' + sql)
  }
}
const dbPath = require.resolve(path.join(__dirname, '../config/db'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: fakePool } }
const router = require('./auth')

const SECRET = process.env.JWT_SECRET || 'krishasure_secret'
const handler = router.stack.find(l => l.route && l.route.path === '/set-new-password').route.stack[0].handle
async function call(body) {
  let out = { status: 200, body: null }
  const res = { status(c) { out.status = c; return this }, json(b) { out.body = b; return this } }
  await handler({ body }, res)
  return out
}
const selectToken = (id, purpose = 'select-membership', exp = '5m') => jwt.sign({ personId: id, purpose }, SECRET, { expiresIn: exp })

test('a person with a temporary password can set a new one before choosing a company, and is not handed another token', async () => {
  people.set(7, { id: 7, mustchangepassword: true })
  updates.length = 0
  const r = await call({ selectToken: selectToken(7), password: 'brand-new-pass' })
  assert.equal(r.status, 200)
  assert.equal(updates.length, 1)
  assert.ok(await bcrypt.compare('brand-new-pass', updates[0][0]))
  assert.equal(updates[0][1], 7)
  // No new token: the person must log in again with the new password.
  assert.equal(r.body.selectToken, undefined); assert.equal(r.body.token, undefined)
})

test('refused when no change is required, so it cannot reset a normal password', async () => {
  people.set(8, { id: 8, mustchangepassword: false })
  updates.length = 0
  const r = await call({ selectToken: selectToken(8), password: 'another-pass' })
  assert.equal(r.status, 400); assert.equal(updates.length, 0)
})

test('refused: short password, missing, expired or wrongly purposed tokens, unknown account', async () => {
  people.set(9, { id: 9, mustchangepassword: true })
  updates.length = 0
  assert.equal((await call({ selectToken: selectToken(9), password: 'abc' })).status, 400)
  assert.equal((await call({ password: 'long-enough' })).status, 400)
  assert.equal((await call({ selectToken: selectToken(9, 'select-membership', '-1s'), password: 'long-enough' })).status, 401)
  assert.equal((await call({ selectToken: selectToken(9, 'something-else'), password: 'long-enough' })).status, 401)
  assert.equal((await call({ selectToken: 'garbage', password: 'long-enough' })).status, 401)
  assert.equal((await call({ selectToken: selectToken(404), password: 'long-enough' })).status, 404)
  assert.equal(updates.length, 0)
})
