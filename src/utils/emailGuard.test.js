const test = require('node:test')
const assert = require('node:assert/strict')
const { guardEmail } = require('./emailGuard')

const base = { subject: 'Hello', html: '<p>Hi</p>', to: 'a@x.com', cc: null }

test('production: nothing changes', () => {
  const r = guardEmail({ ...base, isUat: false, allowlist: '', to: 'real@client.com,b@y.com', cc: 'c@z.com' })
  assert.equal(r.send, true); assert.equal(r.to, 'real@client.com,b@y.com'); assert.equal(r.cc, 'c@z.com')
  assert.equal(r.subject, 'Hello'); assert.equal(r.html, '<p>Hi</p>')
  assert.deepEqual(r.dropped, []); assert.deepEqual(r.redirected, [])
})

test('UAT: someone not on the list is redirected to your inbox, with a note', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net', to: 'real@client.com' })
  assert.equal(r.send, true); assert.equal(r.to, 'me@krishasolutions.net')
  assert.equal(r.subject, '[UAT] (for real@client.com) Hello')
  assert.match(r.html, /meant for real@client\.com/); assert.ok(r.html.endsWith('<p>Hi</p>'))
  assert.deepEqual(r.redirected, ['real@client.com']); assert.deepEqual(r.dropped, [])
})

test('UAT: allowed recipients still get it; others are swapped for your inbox, once', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net, @uat-test.com', to: 'qa@uat-test.com,real@client.com,other@client.com', cc: 'boss@client.com,qa2@uat-test.com' })
  assert.equal(r.to, 'qa@uat-test.com,me@krishasolutions.net')
  assert.equal(r.cc, 'qa2@uat-test.com')
  assert.deepEqual(r.redirected, ['real@client.com', 'other@client.com', 'boss@client.com'])
  assert.equal(r.subject, '[UAT] (for real@client.com +2) Hello')
})

test('UAT: an allowed recipient only: no note, just the [UAT] subject', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net', to: 'ME@krishasolutions.net' })
  assert.equal(r.send, true); assert.equal(r.subject, '[UAT] Hello'); assert.equal(r.html, '<p>Hi</p>')
})

test('UAT: the inbox is not added twice when it is already a recipient', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net', to: 'me@krishasolutions.net,real@client.com' })
  assert.equal(r.to, 'me@krishasolutions.net')
})

test('UAT: with only a domain rule there is no inbox, so others are dropped', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: '@uat-test.com', to: 'real@client.com' })
  assert.equal(r.send, false); assert.deepEqual(r.dropped, ['real@client.com']); assert.deepEqual(r.redirected, [])
})

test('UAT: an empty allowlist sends nothing at all', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: undefined })
  assert.equal(r.send, false); assert.deepEqual(r.dropped, ['a@x.com'])
})

test('UAT: a domain rule does not match a look-alike address', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: '@uat-test.com', to: 'x@evil-uat-test.com.au' })
  assert.equal(r.send, false)
})

test('UAT: a plus-address of an allowed mailbox is allowed, but not the other way round', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@krishasolutions.net', to: 'me+client1@krishasolutions.net' })
  assert.equal(r.to, 'me+client1@krishasolutions.net'); assert.deepEqual(r.redirected, [])
  const r2 = guardEmail({ ...base, isUat: true, allowlist: 'me+client1@krishasolutions.net', to: 'me@krishasolutions.net' })
  assert.equal(r2.to, 'me+client1@krishasolutions.net'); assert.deepEqual(r2.redirected, ['me@krishasolutions.net'])
})

test('UAT: array recipients stay arrays, and html in an address is escaped in the note', () => {
  const r = guardEmail({ ...base, isUat: true, allowlist: 'me@x.io', to: ['a@uat.io'] })
  assert.deepEqual(r.to, ['me@x.io'])
  const r2 = guardEmail({ ...base, isUat: true, allowlist: 'me@x.io', to: '"><b>x@y.io' })
  assert.ok(!r2.html.includes('<b>x@y.io')); assert.match(r2.html, /&lt;b&gt;/)
})
