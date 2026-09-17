// Regression coverage for the hours-rollover logic in contractPeriod.js.
// There's no scheduled job to test against real time — rollover happens
// lazily, on read (see that file's own header comment) — so these tests
// exercise it the same way production does: by handing advancePeriodIfDue
// an org whose currentPeriodStart is already in the past relative to a
// fixed `now`, against a fake pool with an in-memory HoursLog.
//
// Run with: node --test  (or: node --test src/utils/contractPeriod.test.js)

const test = require('node:test')
const assert = require('node:assert/strict')
const { isContractActive, advancePeriodIfDue, computeOrgBalance } = require('./contractPeriod')

// Minimal stand-in for HoursLog joined to Tickets on clientOrgId — real
// enough to drive the two query shapes contractPeriod.js actually issues
// (a bounded [start, end) range during rollover, and an unbounded >=start
// range for the current-period balance), without needing a real DB.
function makeFakePool(hoursLogEntries) {
  const updateCalls = []
  return {
    updateCalls,
    query: async (sql, params) => {
      if (/UPDATE ClientOrganizations/i.test(sql)) {
        updateCalls.push({ currentPeriodStart: params[0], carriedOverHours: params[1], orgId: params[2] })
        return { rows: [] }
      }
      if (/SELECT COALESCE\(SUM/i.test(sql)) {
        // params[1]/[2] can be a Date or a plain 'YYYY-MM-DD' string
        // (org rows read straight off a fake row object, same as real
        // Postgres columns coming back as strings) — compare by
        // timestamp either way, never with a bare >=/< on mixed types.
        const [, start, end] = params
        const startMs = new Date(start).getTime()
        const endMs = end === undefined ? undefined : new Date(end).getTime()
        const total = hoursLogEntries
          .filter(e => e.loggedAt.getTime() >= startMs && (endMs === undefined || e.loggedAt.getTime() < endMs))
          .reduce((sum, e) => sum + e.hoursSpent, 0)
        return { rows: [{ totalused: String(total) }] }
      }
      throw new Error(`Unexpected query in test: ${sql}`)
    }
  }
}

test('isContractActive', async (t) => {
  await t.test('false when hasHoursContract is not set', () => {
    assert.equal(isContractActive({ hashourscontract: false }), false)
  })

  await t.test('true when active with no end date', () => {
    assert.equal(isContractActive({ hashourscontract: true, contractenddate: null }), true)
  })

  await t.test('true when end date is still in the future', () => {
    const now = new Date('2020-06-15')
    assert.equal(isContractActive({ hashourscontract: true, contractenddate: '2020-12-31' }, now), true)
  })

  await t.test('false once end date has passed — same as no contract', () => {
    const now = new Date('2021-01-15')
    assert.equal(isContractActive({ hashourscontract: true, contractenddate: '2020-12-31' }, now), false)
  })
})

test('advancePeriodIfDue: no-op cases', async (t) => {
  await t.test('unrecognized resetCadence is a no-op', async () => {
    const pool = makeFakePool([])
    const org = { id: 1, resetcadence: 'Fortnightly', currentperiodstart: '2020-01-01' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-06-01'))
    assert.equal(result, org)
    assert.equal(pool.updateCalls.length, 0)
  })

  await t.test('missing currentPeriodStart is a no-op', async () => {
    const pool = makeFakePool([])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: null }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-06-01'))
    assert.equal(result, org)
    assert.equal(pool.updateCalls.length, 0)
  })

  await t.test('not yet due — now is still inside the current period', async () => {
    const pool = makeFakePool([])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Roll over' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-01-15'))
    assert.equal(result, org)
    assert.equal(pool.updateCalls.length, 0)
  })

  await t.test('boundary: now exactly at periodEnd counts as due (strict < means equality still advances)', async () => {
    const pool = makeFakePool([])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: '2020-01-01T00:00:00.000Z', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Settle separately' }
    const periodEnd = new Date('2020-02-01T00:00:00.000Z')
    const result = await advancePeriodIfDue(pool, org, periodEnd)
    assert.equal(pool.updateCalls.length, 1)
    assert.equal(new Date(result.currentperiodstart).getTime(), periodEnd.getTime())
  })
})

test('advancePeriodIfDue: single elapsed period', async (t) => {
  await t.test('"Settle separately" drops the overage — new period starts clean', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2020-01-10'), hoursSpent: 15 } // 15 used against a 10hr allowance = 5hr overage
    ])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Settle separately' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-02-15'))

    assert.equal(new Date(result.currentperiodstart).getTime(), new Date('2020-02-01').getTime())
    assert.equal(result.carriedoverhours, 0)
    assert.deepEqual(pool.updateCalls[0], {
      currentPeriodStart: new Date('2020-02-01'),
      carriedOverHours: 0,
      orgId: 1
    })
  })

  await t.test('"Roll over" carries the overage into the next period', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2020-01-10'), hoursSpent: 15 }
    ])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Roll over' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-02-15'))

    assert.equal(result.carriedoverhours, 5)
  })

  await t.test('no usage in the elapsed period never produces a negative carry', async () => {
    const pool = makeFakePool([])
    const org = { id: 1, resetcadence: 'Monthly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Roll over' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-02-15'))

    assert.equal(result.carriedoverhours, 0)
  })
})

test('advancePeriodIfDue: multiple elapsed periods (the while-loop path)', async (t) => {
  await t.test('walks each boundary in order, compounding "Roll over" carry correctly', async () => {
    // Jan 1 – Feb 1: 15 used, 10hr allowance -> 5hr overage carried
    // Feb 1 – Mar 1: allowance drops to 10-5=5, exactly 5 used -> 0 overage, carry resets to 0
    // Mar 1 – Apr 1: allowance back to 10, 12 used -> 2hr overage carried
    // "now" = Apr 15, so three full periods have elapsed by the time this runs
    const pool = makeFakePool([
      { loggedAt: new Date('2020-01-10'), hoursSpent: 15 },
      { loggedAt: new Date('2020-02-10'), hoursSpent: 5 },
      { loggedAt: new Date('2020-03-10'), hoursSpent: 12 }
    ])
    const org = { id: 7, resetcadence: 'Monthly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 10, overtimehandling: 'Roll over' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-04-15'))

    assert.equal(new Date(result.currentperiodstart).getTime(), new Date('2020-04-01').getTime())
    assert.equal(result.carriedoverhours, 2)
    // Only the final state is persisted — one UPDATE for the whole
    // catch-up, not one per elapsed period.
    assert.equal(pool.updateCalls.length, 1)
  })

  await t.test('Quarterly cadence advances by 3-month boundaries, not monthly ones', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2020-02-01'), hoursSpent: 5 } // inside the Jan–Apr quarter, under allowance
    ])
    const org = { id: 1, resetcadence: 'Quarterly', currentperiodstart: '2020-01-01', carriedoverhours: 0, contractedhours: 30, overtimehandling: 'Roll over' }
    const result = await advancePeriodIfDue(pool, org, new Date('2020-05-01'))

    assert.equal(new Date(result.currentperiodstart).getTime(), new Date('2020-04-01').getTime())
    assert.equal(result.carriedoverhours, 0)
  })
})

test('computeOrgBalance', async (t) => {
  await t.test('under allowance: hoursRemaining is positive, overtimeHours is 0, and usage before currentPeriodStart is ignored', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2019-12-15'), hoursSpent: 100 }, // before the period — must be ignored
      { loggedAt: new Date('2020-01-10'), hoursSpent: 4 }
    ])
    const org = { id: 1, currentperiodstart: '2020-01-01', contractedhours: 10, carriedoverhours: 0, resetcadence: 'Monthly', contractenddate: null }
    const balance = await computeOrgBalance(pool, org)

    assert.equal(balance.hoursUsed, 4)
    assert.equal(balance.hoursRemaining, 6)
    assert.equal(balance.overtimeHours, 0)
  })

  await t.test('over allowance: hoursRemaining floors at 0, overtimeHours reports the excess', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2020-01-10'), hoursSpent: 14 }
    ])
    const org = { id: 1, currentperiodstart: '2020-01-01', contractedhours: 10, carriedoverhours: 0, resetcadence: 'Monthly', contractenddate: null }
    const balance = await computeOrgBalance(pool, org)

    assert.equal(balance.hoursRemaining, 0)
    assert.equal(balance.overtimeHours, 4)
  })

  await t.test('a carried-over debt shrinks this period\'s allowance before usage is even counted', async () => {
    const pool = makeFakePool([
      { loggedAt: new Date('2020-02-10'), hoursSpent: 4 }
    ])
    const org = { id: 1, currentperiodstart: '2020-02-01', contractedhours: 10, carriedoverhours: 5, resetcadence: 'Monthly', contractenddate: null }
    const balance = await computeOrgBalance(pool, org)

    // Allowance is 10 - 5 = 5, so 4 used leaves 1 remaining, not 6.
    assert.equal(balance.hoursRemaining, 1)
    assert.equal(balance.overtimeHours, 0)
  })
})
