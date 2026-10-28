const test = require('node:test')
const assert = require('node:assert/strict')
const { TRIAL_DAYS, isTrialExpired, trialDaysLeft, nextTrialEnd, addDays } = require('./trial')

const now = new Date('2026-11-01T09:00:00Z')

test('no trial date means not on a trial, never expired', () => {
  assert.equal(isTrialExpired(null, now), false)
  assert.equal(trialDaysLeft(null, now), null)
})

test('a trial is 15 days from the start', () => {
  const { trialEndsAt } = nextTrialEnd('start', null, undefined, now)
  assert.equal(trialEndsAt.toISOString(), '2026-11-16T09:00:00.000Z')
  assert.equal(TRIAL_DAYS, 15)
  assert.equal(trialDaysLeft(trialEndsAt, now), 15)
})

test('expired at the moment it ends, not before', () => {
  const ends = addDays(now, 1)
  assert.equal(isTrialExpired(ends, now), false)
  assert.equal(isTrialExpired(ends, ends), true)
  assert.equal(trialDaysLeft(ends, ends), 0)
})

test('part of a day left counts as a day', () => {
  assert.equal(trialDaysLeft(new Date('2026-11-01T10:00:00Z'), now), 1)
})

test('extending adds to a running trial', () => {
  const current = addDays(now, 2)
  assert.equal(nextTrialEnd('extend', current, 7, now).trialEndsAt.toISOString(), addDays(current, 7).toISOString())
})

test('extending an ended trial counts from today', () => {
  const ended = addDays(now, -10)
  assert.equal(nextTrialEnd('extend', ended, 7, now).trialEndsAt.toISOString(), addDays(now, 7).toISOString())
})

test('extend defaults to 7 days and rejects bad numbers', () => {
  assert.equal(nextTrialEnd('extend', null, undefined, now).trialEndsAt.toISOString(), addDays(now, 7).toISOString())
  for (const bad of [0, -3, 2.5, 'abc', 61]) assert.match(nextTrialEnd('extend', null, bad, now).error, /between 1 and 60/)
})

test('converting to paid clears the trial; unknown actions are refused', () => {
  assert.deepEqual(nextTrialEnd('convert', addDays(now, 3), undefined, now), { trialEndsAt: null })
  assert.ok(nextTrialEnd('nope', null, undefined, now).error)
})
