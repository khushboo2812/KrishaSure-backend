// Who a ticket goes to, and who it escalates to. Pure functions over
// plain rows, so the rules are easy to test and the frontend's
// auto-assignment (Dashboard.jsx's autoAssign) can mirror them.
//
// Agents are the company's own people grouped into admin-defined
// levels (Settings -> Agent Levels), ordered lowest to highest. A
// priority's "starting level" (Settings -> Assignment & Escalation)
// decides who a new ticket goes to; escalation moves a breached ticket
// up the ladder. Suppliers sit outside the ladder: they're eligible for
// tickets in their own categories whatever the starting level, and are
// never escalated to or picked by fallbacks.

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

function parseSkills(skills) {
  return (skills || '').split(',').map(s => s.trim()).filter(Boolean)
}

function isSupplier(agent) {
  return agent.membershiprole === 'supplier'
}

function openTicketCount(tickets, agentName) {
  return tickets.filter(t => t.assignedto === agentName && t.status !== 'Resolved').length
}

function leastLoaded(agents, tickets) {
  const loaded = agents.map((agent, i) => ({ agent, i, count: openTicketCount(tickets, agent.name) }))
  loaded.sort((a, b) => a.count - b.count || a.i - b.i)
  return loaded[0]?.agent || null
}

// agents: active people who can hold tickets. startLevelName: the
// level this ticket's priority starts at (null/undefined = no
// preference, any matching agent).
function pickAssignee({ agents, tickets, category, startLevelName }) {
  let matched = agents.filter(a => parseSkills(a.skills).includes(category))
  if (matched.length === 0) matched = agents.filter(a => !isSupplier(a))
  if (matched.length === 0) return null

  if (startLevelName) {
    const atLevel = matched.filter(a => isSupplier(a) || a.level === startLevelName)
    if (atLevel.length > 0) matched = atLevel
  }
  return leastLoaded(matched, tickets)
}

// levels: [{ id, name, rank }] in any order. Returns them lowest first.
function sortLevels(levels) {
  return [...levels].sort((a, b) => a.rank - b.rank || a.id - b.id)
}

// The next person up the ladder from `currentAssignee`, no higher than
// the priority's ceiling (maxLevelId, null = the top level). Prefers
// the nearest level above that has someone with the ticket's skill;
// failing that, the nearest level above with anyone at all. null when
// they're already at the ceiling or nobody above them can take it.
function chooseEscalationTarget({ agents, tickets, currentAssignee, category, levels, maxLevelId }) {
  const ladder = sortLevels(levels)
  if (ladder.length === 0) return null

  const currentIdx = ladder.findIndex(l => l.name === currentAssignee.level)
  let maxIdx = maxLevelId != null ? ladder.findIndex(l => Number(l.id) === Number(maxLevelId)) : -1
  if (maxIdx === -1) maxIdx = ladder.length - 1
  if (currentIdx >= maxIdx) return null

  const pool = agents.filter(a => !isSupplier(a) && a.name !== currentAssignee.name)

  for (let idx = currentIdx + 1; idx <= maxIdx; idx++) {
    const withSkill = pool.filter(a => a.level === ladder[idx].name && parseSkills(a.skills).includes(category))
    if (withSkill.length > 0) return { agent: leastLoaded(withSkill, tickets), level: ladder[idx] }
  }
  for (let idx = currentIdx + 1; idx <= maxIdx; idx++) {
    const anyone = pool.filter(a => a.level === ladder[idx].name)
    if (anyone.length > 0) return { agent: leastLoaded(anyone, tickets), level: ladder[idx] }
  }
  return null
}

// The Nth escalation of a round happens once N full SLA windows of
// active business hours have passed (the first at the breach itself),
// and the early warning goes out at 75% of the first window.
const WARNING_FRACTION = 0.75

function escalationDue({ activeHours, maxHours, escalatedCount }) {
  return activeHours >= maxHours * (escalatedCount + 1)
}

function warningDue({ activeHours, maxHours, escalatedCount }) {
  return escalatedCount === 0 && activeHours >= maxHours * WARNING_FRACTION && activeHours < maxHours
}

module.exports = {
  PRIORITIES, parseSkills, isSupplier, pickAssignee, sortLevels,
  chooseEscalationTarget, escalationDue, warningDue, WARNING_FRACTION
}
