const test = require('node:test')
const assert = require('node:assert/strict')
const { businessHoursElapsed, zonedTimeToUtc, getZonedParts, getEffectiveBusinessHours } = require('./businessHours')

const STANDARD = { businessDays: 'Mon,Tue,Wed,Thu,Fri', businessHoursStart: '09:00', businessHoursEnd: '17:00', timezone: 'UTC' }

test('zonedTimeToUtc / getZonedParts round-trip', async (t) => {
  await t.test('UTC is the identity zone', () => {
    const d = zonedTimeToUtc(2026, 9, 15, 9, 0, 'UTC')
    assert.equal(d.toISOString(), '2026-09-15T09:00:00.000Z')
  })

  await t.test('a real IANA zone with a UTC offset', () => {
    // 9am in New York in September (EDT, UTC-4) is 13:00 UTC.
    const d = zonedTimeToUtc(2026, 9, 15, 9, 0, 'America/New_York')
    assert.equal(d.toISOString(), '2026-09-15T13:00:00.000Z')
  })

  await t.test('round-trips back to the same wall-clock parts', () => {
    const d = zonedTimeToUtc(2026, 3, 10, 14, 30, 'Asia/Kolkata')
    const parts = getZonedParts(d, 'Asia/Kolkata')
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 3)
    assert.equal(parts.day, 10)
    assert.equal(parts.hour, 14)
    assert.equal(parts.minute, 30)
  })
})

test('businessHoursElapsed: same business day', async (t) => {
  await t.test('fully inside the window counts every minute', () => {
    // Tue Sep 15 2026, 10:00 -> 14:00 UTC — both inside 09:00-17:00
    const hrs = businessHoursElapsed('2026-09-15T10:00:00Z', '2026-09-15T14:00:00Z', STANDARD)
    assert.equal(hrs, 4)
  })

  await t.test('clips a start before business hours to the day open', () => {
    // Starts at 6am (before 9am open), ends at 11am -> only 9-11 counts (2h)
    const hrs = businessHoursElapsed('2026-09-15T06:00:00Z', '2026-09-15T11:00:00Z', STANDARD)
    assert.equal(hrs, 2)
  })

  await t.test('clips an end after business hours to the day close', () => {
    // Starts at 15:00, ends at 20:00 (after 17:00 close) -> only 15-17 counts (2h)
    const hrs = businessHoursElapsed('2026-09-15T15:00:00Z', '2026-09-15T20:00:00Z', STANDARD)
    assert.equal(hrs, 2)
  })

  await t.test('entirely before opening or after closing counts as zero', () => {
    const before = businessHoursElapsed('2026-09-15T05:00:00Z', '2026-09-15T08:00:00Z', STANDARD)
    const after = businessHoursElapsed('2026-09-15T18:00:00Z', '2026-09-15T20:00:00Z', STANDARD)
    assert.equal(before, 0)
    assert.equal(after, 0)
  })
})

test('businessHoursElapsed: the actual thing the user asked for — weekends excluded', async (t) => {
  await t.test('a ticket sitting open over a weekend does not accrue weekend hours', () => {
    // Fri Sep 18 2026, opened at 14:00 -> Mon Sep 21 2026, checked at 11:00.
    // Counts: Fri 14:00-17:00 (3h) + Mon 09:00-11:00 (2h) = 5h. Sat/Sun: 0.
    const hrs = businessHoursElapsed('2026-09-18T14:00:00Z', '2026-09-21T11:00:00Z', STANDARD)
    assert.equal(hrs, 5)
  })

  await t.test('a window that starts and ends on a weekend is entirely zero', () => {
    const hrs = businessHoursElapsed('2026-09-19T10:00:00Z', '2026-09-20T15:00:00Z', STANDARD) // Sat -> Sun
    assert.equal(hrs, 0)
  })
})

test('businessHoursElapsed: multi-day spans', async (t) => {
  await t.test('sums a full business day in the middle correctly', () => {
    // Mon 16:00 -> Wed 10:00: Mon(16-17=1h) + Tue(9-17=8h) + Wed(9-10=1h) = 10h
    const hrs = businessHoursElapsed('2026-09-14T16:00:00Z', '2026-09-16T10:00:00Z', STANDARD)
    assert.equal(hrs, 10)
  })

  await t.test('end before start is zero, never negative', () => {
    const hrs = businessHoursElapsed('2026-09-15T14:00:00Z', '2026-09-15T10:00:00Z', STANDARD)
    assert.equal(hrs, 0)
  })
})

test('businessHoursElapsed: custom config', async (t) => {
  await t.test('a company that also works Saturday counts it', () => {
    const cfg = { ...STANDARD, businessDays: 'Mon,Tue,Wed,Thu,Fri,Sat' }
    // Fri 16:00 -> Sat 11:00: Fri(16-17=1h) + Sat(9-11=2h) = 3h
    const hrs = businessHoursElapsed('2026-09-18T16:00:00Z', '2026-09-19T11:00:00Z', cfg)
    assert.equal(hrs, 3)
  })

  await t.test('a narrower window (10-15) is respected', () => {
    const cfg = { ...STANDARD, businessHoursStart: '10:00', businessHoursEnd: '15:00' }
    const hrs = businessHoursElapsed('2026-09-15T08:00:00Z', '2026-09-15T20:00:00Z', cfg)
    assert.equal(hrs, 5)
  })

  await t.test('a non-UTC timezone shifts which UTC instants count as "business hours"', () => {
    // 09:00-17:00 America/New_York (EDT, UTC-4) on Sep 15 2026 is 13:00-21:00 UTC.
    // A window of 12:00-22:00 UTC should clip to that: 13:00-21:00 = 8h.
    const cfg = { ...STANDARD, timezone: 'America/New_York' }
    const hrs = businessHoursElapsed('2026-09-15T12:00:00Z', '2026-09-15T22:00:00Z', cfg)
    assert.equal(hrs, 8)
  })

  await t.test('missing config falls back to the Mon-Fri 9-5 UTC default', () => {
    const hrs = businessHoursElapsed('2026-09-15T10:00:00Z', '2026-09-15T14:00:00Z', null)
    assert.equal(hrs, 4)
  })
})

test('getEffectiveBusinessHours', async (t) => {
  const company = STANDARD
  const clientOverride = { businessDays: 'Mon,Tue,Wed,Thu,Fri,Sat', businessHoursStart: '08:00', businessHoursEnd: '20:00', timezone: 'Asia/Kolkata' }

  await t.test('no client org (null) falls back to the company\'s hours', () => {
    assert.deepEqual(getEffectiveBusinessHours(company, null), company)
  })

  await t.test('a client org with no override configured (businessDays null) falls back to the company\'s hours', () => {
    assert.deepEqual(getEffectiveBusinessHours(company, { businessDays: null }), company)
  })

  await t.test('a client org with an override configured uses its own hours', () => {
    assert.deepEqual(getEffectiveBusinessHours(company, clientOverride), clientOverride)
  })
})
