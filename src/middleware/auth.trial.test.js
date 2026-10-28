// An expired free trial stops a signed-in company user (403 with the
// trial wording), a running trial or no trial lets them through, and
// the platform owner is never stopped.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jwt = require('jsonwebtoken')

let row
const fakePool = { query: async () => ({ rows: [row] }) }
const dbPath = require.resolve(path.join(__dirname, '../config/db'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: fakePool } }
const { authenticateToken } = require('./auth')
const { TRIAL_ENDED_MESSAGE } = require('../utils/trial')

const SECRET = process.env.JWT_SECRET || 'krishasure_secret'
const DAY = 24 * 60 * 60 * 1000

function call(role) {
  const token = jwt.sign({ role, membershipId: 1 }, SECRET)
  return new Promise(resolve => {
    const res = { status(code) { this.code = code; return this }, json(body) { resolve({ code: this.code, body }) } }
    authenticateToken({ headers: { authorization: `Bearer ${token}` } }, res, () => resolve({ code: 200 }))
  })
}

test('an ended trial blocks a company user with the trial message', async () => {
  row = { companyactive: true, membershipactive: true, trialendsat: new Date(Date.now() - DAY) }
  const out = await call('agent')
  assert.equal(out.code, 403)
  assert.equal(out.body.error, TRIAL_ENDED_MESSAGE)
})

test('a running trial, or no trial, lets them through', async () => {
  row = { companyactive: true, membershipactive: true, trialendsat: new Date(Date.now() + DAY) }
  assert.equal((await call('agent')).code, 200)
  row = { companyactive: true, membershipactive: true, trialendsat: null }
  assert.equal((await call('agent')).code, 200)
})

test('the platform owner is never blocked', async () => {
  row = { companyactive: true, membershipactive: true, trialendsat: new Date(Date.now() - DAY) }
  assert.equal((await call('platform_owner')).code, 200)
})
