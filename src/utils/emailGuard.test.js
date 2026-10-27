const test = require('node:test')
const assert = require('node:assert/strict')
const { guardEmail } = require('./emailGuard')

const base = { subject: 'Hello', to: 'a@x.com', cc: null }

test('production: nothing changes', () => {
  const r = guardEmail({ ...base, isUat: false, allowlist: '', to: 'real@client.com,b@y.com', cc: 'c@z.com' })
  assert.equal(r.send, true); assert.equal(r.to, 'real@client.com,b@y.com'); assert.equal(r.cc, 'c@z.com')
  assert.equal(r.subject, 'Hello'); assert.deepEqual(r.dropped, [])
})

test('UAT: an empty allowlist blocks everything', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: undefined })
  assert.equal(r.send, false); assert.deepEqual(r.dropped, ['a@x.com'])
})

test('UAT: allowed addresses and whole domains go through, others are dropped', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net, @uat-test.com', to: 'Me@KrishaSolutions.net,real@client.com,qa@uat-test.com', cc: 'boss@client.com,qa2@uat-test.com' })
  assert.equal(r.send, true)
  assert.equal(r.to, 'Me@KrishaSolutions.net,qa@uat-test.com')
  assert.equal(r.cc, 'qa2@uat-test.com')
  assert.deepEqual(r.dropped, ['real@client.com', 'boss@client.com'])
  assert.equal(r.subject, '[UAT] Hello')
})

test('UAT: a domain rule does not match a look-alike address', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: '@uat-test.com', to: 'x@evil-uat-test.com.au' })
  assert.equal(r.send, false)
})

test('UAT: a cc left with nobody becomes null, and array recipients stay arrays', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: '@uat-test.com', to: ['a@uat-test.com', 'b@real.com'], cc: 'c@real.com' })
  assert.deepEqual(r.to, ['a@uat-test.com']); assert.equal(r.cc, null)
})

test('UAT: a plus-address of an allowed mailbox is allowed, but not the other way round', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net', to: 'me+client1@krishasolutions.net,other+me@krishasolutions.net' })
  assert.equal(r.to, 'me+client1@krishasolutions.net'); assert.deepEqual(r.dropped, ['other+me@krishasolutions.net'])
  const r2 = guardEmail({ ...base, isUat: true, allowlist: 'me+client1@krishasolutions.net', to: 'me@krishasolutions.net' })
  assert.equal(r2.send, false)
})
