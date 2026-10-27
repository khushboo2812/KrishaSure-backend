const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePlanLimits } = require('./planLimits')

test('nothing sent means unlimited, AI on, not enforced', () => {
  assert.deepEqual(parsePlanLimits({}), { maxUsers: null, aiEnabled: true, maxAiRequestsPerMonth: null, enforceUsageLimits: false })
  assert.deepEqual(parsePlanLimits(undefined), { maxUsers: null, aiEnabled: true, maxAiRequestsPerMonth: null, enforceUsageLimits: false })
})

test('a plan: numbers, numeric strings and blanks', () => {
  assert.deepEqual(parsePlanLimits({ maxUsers: 15, aiEnabled: true, maxAiRequestsPerMonth: '100', enforceUsageLimits: true }),
    { maxUsers: 15, aiEnabled: true, maxAiRequestsPerMonth: 100, enforceUsageLimits: true })
  assert.deepEqual(parsePlanLimits({ maxUsers: '', maxAiRequestsPerMonth: null }),
    { maxUsers: null, aiEnabled: true, maxAiRequestsPerMonth: null, enforceUsageLimits: false })
})

test('no AI plan', () => {
  assert.equal(parsePlanLimits({ maxUsers: 5, aiEnabled: false }).aiEnabled, false)
})

test('zero is allowed, negatives, fractions and text are refused', () => {
  assert.equal(parsePlanLimits({ maxUsers: 0 }).maxUsers, 0)
  for (const bad of [-1, 2.5, 'abc', '1e3x', NaN]) {
    assert.match(parsePlanLimits({ maxUsers: bad }).error, /Max users/)
    assert.match(parsePlanLimits({ maxAiRequestsPerMonth: bad }).error, /Max AI requests/)
  }
})
