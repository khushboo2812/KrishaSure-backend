const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePendingSettings, pendingAction } = require('./pendingSettings')

test('numbers, numeric strings and nulls', () => {
  assert.deepEqual(parsePendingSettings({ pendingReminderDays: 3, pendingAutoCloseDays: '14' }), { pendingReminderDays: 3, pendingAutoCloseDays: 14 })
  assert.deepEqual(parsePendingSettings({ pendingReminderDays: null, pendingAutoCloseDays: null }), { pendingReminderDays: null, pendingAutoCloseDays: null })
  assert.deepEqual(parsePendingSettings({ pendingReminderDays: '', pendingAutoCloseDays: 10 }), { pendingReminderDays: null, pendingAutoCloseDays: 10 })
})

test('both fields have to be sent', () => {
  assert.match(parsePendingSettings({}).error, /both/)
  assert.match(parsePendingSettings({ pendingReminderDays: 3 }).error, /both/)
})

test('bad numbers are refused', () => {
  for (const bad of [0, -1, 2.5, 'abc', 61]) {
    assert.match(parsePendingSettings({ pendingReminderDays: bad, pendingAutoCloseDays: null }).error, /Reminder/)
    assert.match(parsePendingSettings({ pendingReminderDays: null, pendingAutoCloseDays: bad }).error, /Auto-close/)
  }
})

test('the reminder must come before the close', () => {
  assert.match(parsePendingSettings({ pendingReminderDays: 5, pendingAutoCloseDays: 5 }).error, /before/)
  assert.match(parsePendingSettings({ pendingReminderDays: 9, pendingAutoCloseDays: 5 }).error, /before/)
  assert.ok(!parsePendingSettings({ pendingReminderDays: 4, pendingAutoCloseDays: 5 }).error)
})

test('job decision with the defaults', () => {
  const s = { reminderDays: 3, closeDays: 5 }
  assert.equal(pendingAction(2, s, false), null)
  assert.equal(pendingAction(3, s, false), 'remind')
  assert.equal(pendingAction(4, s, true), null)
  assert.equal(pendingAction(5, s, true), 'close')
  assert.equal(pendingAction(7, s, false), 'close')
})

test('switched-off steps never fire', () => {
  assert.equal(pendingAction(30, { reminderDays: null, closeDays: null }, false), null)
  assert.equal(pendingAction(4, { reminderDays: null, closeDays: 5 }, false), null)
  assert.equal(pendingAction(5, { reminderDays: null, closeDays: 5 }, false), 'close')
  assert.equal(pendingAction(20, { reminderDays: 3, closeDays: null }, false), 'remind')
  assert.equal(pendingAction(20, { reminderDays: 3, closeDays: null }, true), null)
})

test('a 14-day close', () => {
  const s = { reminderDays: 7, closeDays: 14 }
  assert.equal(pendingAction(13, s, true), null)
  assert.equal(pendingAction(14, s, true), 'close')
})
