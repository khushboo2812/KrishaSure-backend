const test = require('node:test')
const assert = require('node:assert/strict')
const { pickAssignee, chooseEscalationTarget, escalationDue, warningDue } = require('./assignment')

const LEVELS = [
  { id: 3, name: 'Lead', rank: 3 },
  { id: 1, name: 'Intern', rank: 1 },
  { id: 2, name: 'Agent', rank: 2 }
]
const agent = (name, level, skills, extra = {}) => ({ name, level, skills, membershiprole: 'agent', ...extra })
const open = (assignedto, n = 1) => Array.from({ length: n }, () => ({ assignedto, status: 'Open/Assigned' }))

test('pickAssignee', async (t) => {
  await t.test('prefers the starting level among agents with the skill', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Ann', 'Agent', 'Hardware'), agent('Lee', 'Lead', 'Hardware')]
    assert.equal(pickAssignee({ agents, tickets: [], category: 'Hardware', startLevelName: 'Agent' }).name, 'Ann')
  })

  await t.test('falls back to any agent with the skill when nobody is at the starting level', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Lee', 'Lead', 'Hardware')]
    assert.equal(pickAssignee({ agents, tickets: [], category: 'Hardware', startLevelName: 'Agent' }).name, 'Ian')
  })

  await t.test('picks the least busy agent, first listed on a tie', () => {
    const agents = [agent('Ann', 'Agent', 'Hardware'), agent('Bob', 'Agent', 'Hardware')]
    assert.equal(pickAssignee({ agents, tickets: open('Ann', 2), category: 'Hardware', startLevelName: 'Agent' }).name, 'Bob')
    assert.equal(pickAssignee({ agents, tickets: [], category: 'Hardware', startLevelName: 'Agent' }).name, 'Ann')
  })

  await t.test('resolved tickets do not count as load', () => {
    const agents = [agent('Ann', 'Agent', 'Hardware'), agent('Bob', 'Agent', 'Hardware')]
    const tickets = [{ assignedto: 'Ann', status: 'Resolved' }, { assignedto: 'Bob', status: 'Open/Assigned' }]
    assert.equal(pickAssignee({ agents, tickets, category: 'Hardware', startLevelName: 'Agent' }).name, 'Ann')
  })

  await t.test('nobody has the skill: anyone but a supplier', () => {
    const agents = [agent('Sam', 'Agent', 'D365', { membershiprole: 'supplier' }), agent('Ann', 'Agent', 'Hardware')]
    assert.equal(pickAssignee({ agents, tickets: [], category: 'Printers', startLevelName: 'Agent' }).name, 'Ann')
    assert.equal(pickAssignee({ agents: [agents[0]], tickets: [], category: 'Printers' }), null)
  })

  await t.test('a supplier covering the category is eligible whatever the starting level', () => {
    const agents = [agent('Sam', 'Intern', 'D365', { membershiprole: 'supplier' }), agent('Lee', 'Lead', 'D365')]
    assert.equal(pickAssignee({ agents, tickets: open('Lee', 0), category: 'D365', startLevelName: 'Lead' }).name, 'Sam')
    assert.equal(pickAssignee({ agents, tickets: open('Sam', 3), category: 'D365', startLevelName: 'Lead' }).name, 'Lee')
  })

  await t.test('no starting level means any matching agent', () => {
    const agents = [agent('Lee', 'Lead', 'Hardware')]
    assert.equal(pickAssignee({ agents, tickets: [], category: 'Hardware', startLevelName: null }).name, 'Lee')
  })
})

test('chooseEscalationTarget', async (t) => {
  const base = { tickets: [], category: 'Hardware', levels: LEVELS, maxLevelId: null }

  await t.test('moves up one level to the nearest agent with the skill', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Ann', 'Agent', 'Hardware'), agent('Lee', 'Lead', 'Hardware')]
    const r = chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0] })
    assert.equal(r.agent.name, 'Ann'); assert.equal(r.level.name, 'Agent')
  })

  await t.test('skips a level that has nobody with the skill', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Ann', 'Agent', 'Finance'), agent('Lee', 'Lead', 'Hardware')]
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0] }).agent.name, 'Lee')
  })

  await t.test('no skill match above: nearest level above with anyone', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Ann', 'Agent', 'Finance'), agent('Lee', 'Lead', 'Finance')]
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0] }).agent.name, 'Ann')
  })

  await t.test('stops at the ceiling', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware'), agent('Ann', 'Agent', 'Hardware'), agent('Lee', 'Lead', 'Hardware')]
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[1], maxLevelId: 2 }), null)
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0], maxLevelId: 2 }).agent.name, 'Ann')
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0], maxLevelId: '2' }).agent.name, 'Ann')
  })

  await t.test('nobody above, or already at the top: null', () => {
    const agents = [agent('Lee', 'Lead', 'Hardware'), agent('Ian', 'Intern', 'Hardware')]
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0] }), null)
    assert.equal(chooseEscalationTarget({ ...base, agents: [agents[1]], currentAssignee: agents[1] }), null)
  })

  await t.test('never picks a supplier, and picks the least busy at the level', () => {
    const agents = [
      agent('Ian', 'Intern', 'Hardware'),
      agent('Sam', 'Agent', 'Hardware', { membershiprole: 'supplier' }),
      agent('Ann', 'Agent', 'Hardware'), agent('Bob', 'Agent', 'Hardware')
    ]
    const r = chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0], tickets: open('Ann', 2) })
    assert.equal(r.agent.name, 'Bob')
  })

  await t.test('an assignee whose level is not on the ladder escalates to the lowest level', () => {
    const agents = [agent('Odd', 'Wizard', 'Hardware'), agent('Ian', 'Intern', 'Hardware')]
    assert.equal(chooseEscalationTarget({ ...base, agents, currentAssignee: agents[0] }).agent.name, 'Ian')
  })

  await t.test('no levels configured: nothing to escalate to', () => {
    const agents = [agent('Ian', 'Intern', 'Hardware')]
    assert.equal(chooseEscalationTarget({ ...base, agents, levels: [], currentAssignee: agents[0] }), null)
  })
})

test('escalation timing', async (t) => {
  await t.test('Nth escalation after N full SLA windows', () => {
    assert.equal(escalationDue({ activeHours: 7.9, maxHours: 8, escalatedCount: 0 }), false)
    assert.equal(escalationDue({ activeHours: 8, maxHours: 8, escalatedCount: 0 }), true)
    assert.equal(escalationDue({ activeHours: 12, maxHours: 8, escalatedCount: 1 }), false)
    assert.equal(escalationDue({ activeHours: 16, maxHours: 8, escalatedCount: 1 }), true)
  })

  await t.test('warning at 75% of the first window only', () => {
    assert.equal(warningDue({ activeHours: 5.9, maxHours: 8, escalatedCount: 0 }), false)
    assert.equal(warningDue({ activeHours: 6, maxHours: 8, escalatedCount: 0 }), true)
    assert.equal(warningDue({ activeHours: 8, maxHours: 8, escalatedCount: 0 }), false)
    assert.equal(warningDue({ activeHours: 12, maxHours: 8, escalatedCount: 1 }), false)
  })
})
