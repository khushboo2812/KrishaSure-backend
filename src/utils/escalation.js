const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getTicketReplyFromAddress } = require('./supportEmail')
const { activeBusinessHours, getEffectiveBusinessHours } = require('./businessHours')
const { resolveSlaRule, getCompanyBusinessHours, getClientOrgBusinessHoursById, getCategoryNameToId, getCompanySlaRules } = require('./slaData')
const { getCompanyLevels } = require('./agentLevels')
const { chooseEscalationTarget, escalationDue, warningDue, isSupplier } = require('./assignment')
const { escapeHtml } = require('./commentNotifications')
const { EMAIL_LOGO } = require('./emailBranding')
const { APP_URL } = require('../config/env')

function shell(heading, bodyHtml, color = '#0A2540') {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${EMAIL_LOGO}
      <h1 style="color: ${color};">${heading}</h1>
      ${bodyHtml}
      <a href="${APP_URL}" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
      <br/><br/>
      <p style="color: #64748B; font-size: 12px;">KrishaSure · Powered by Krisha Solutions</p>
    </div>
  `
}

function ticketTable(ticket, extraRows = '') {
  return `
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket</strong></td><td style="padding: 8px;">${ticket.ticketid} — ${escapeHtml(ticket.title)}</td></tr>
      <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Category / Priority</strong></td><td style="padding: 8px;">${escapeHtml(ticket.category)} / ${ticket.priority}</td></tr>
      ${extraRows}
    </table>`
}

// Hourly job (see index.js). For every company that has switched
// escalation on, an open ticket past its SLA moves up one level in the
// company's agent ladder (Settings -> Assignment & Escalation sets how
// far, per priority). Further SLA windows move it up again. Tickets
// waiting on the client (Pending) are skipped — their clock is paused.
// A ticket nobody above can take, or one held by a supplier (who
// aren't on the ladder), alerts the company's superadmins once instead.
//
// Returns a report with one line per unresolved ticket saying what was
// done or why nothing was — the hourly job ignores it, but the manual
// check (POST /api/companies/run-escalation-check) shows it, since a
// ticket that doesn't move has many possible reasons.
async function runEscalations(now = new Date()) {
  const report = []
  const all = await pool.query('SELECT id, name, escalationEnabled FROM Companies WHERE isActive = true')
  for (const company of all.rows) {
    if (!company.escalationenabled) {
      report.push({ company: company.name, ticket: null, outcome: 'Escalation is switched off for this company' })
      continue
    }
    try {
      await escalateCompany(company, now, report)
    } catch (err) {
      console.error(`Escalation failed for ${company.name}:`, err.message)
      report.push({ company: company.name, ticket: null, outcome: `Failed: ${err.message}` })
    }
  }
  return report
}

async function escalateCompany(company, now, report = []) {
  const companyId = company.id
  const note = (ticket, outcome) => report.push({ company: company.name, ticket: ticket.ticketid, outcome })
  const [levels, routingResult, slaRules, categoryNameToId, companyHours, orgHours] = await Promise.all([
    getCompanyLevels(companyId),
    pool.query('SELECT priority, escalate, maxLevelId FROM PriorityRouting WHERE companyId = $1', [companyId]),
    getCompanySlaRules(companyId),
    getCategoryNameToId(companyId),
    getCompanyBusinessHours(companyId),
    getClientOrgBusinessHoursById(companyId)
  ])
  if (levels.length === 0) {
    report.push({ company: company.name, ticket: null, outcome: 'This company has no agent levels set up' })
    return
  }
  const routingByPriority = {}
  routingResult.rows.forEach(r => { routingByPriority[r.priority] = r })

  const agentsResult = await pool.query(
    `SELECT a.*, m.role AS membershipRole FROM Agents a
     JOIN People p ON LOWER(p.email) = LOWER(a.email)
     JOIN Memberships m ON m.personId = p.id AND m.companyId = a.companyId
     WHERE a.companyId = $1 AND m.isActive = true`,
    [companyId]
  )
  const agents = agentsResult.rows
  const allTickets = await pool.query('SELECT * FROM Tickets WHERE companyId = $1', [companyId])
  const tickets = allTickets.rows
  const candidates = tickets.filter(t => (t.status === 'Open/Assigned') && t.assignedto)
  tickets.filter(t => t.status === 'Pending').forEach(t => note(t, 'Skipped: waiting on the client (Pending), its SLA clock is paused'))
  tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Pending' && !candidates.includes(t)).forEach(t => note(t, `Skipped: ${t.assignedto ? `status is ${t.status}` : 'not assigned to anyone'}`))

  const adminsResult = await pool.query(
    "SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1 AND m.isActive = true",
    [companyId]
  )
  const adminEmails = adminsResult.rows.map(a => a.email).join(',')

  for (const ticket of candidates) {
    const routing = routingByPriority[ticket.priority]
    if (routing && routing.escalate === false) { note(ticket, `Skipped: escalation is unticked for ${ticket.priority} tickets`); continue }

    const rule = resolveSlaRule(ticket, slaRules, categoryNameToId)
    if (!rule) { note(ticket, `Skipped: no SLA rule applies to a ${ticket.priority} ${ticket.category} ticket`); continue }
    if (rule.maxhours === null) { note(ticket, 'Skipped: its SLA rule is set to no limit'); continue }
    const maxHours = Number(rule.maxhours)

    const effective = getEffectiveBusinessHours(companyHours, orgHours?.[ticket.clientorgid])
    const activeHours = activeBusinessHours(ticket, now, effective)
    const state = { activeHours, maxHours, escalatedCount: ticket.escalatedcount || 0 }
    const assignee = agents.find(a => a.name === ticket.assignedto)
    if (!assignee) { note(ticket, `Skipped: ${ticket.assignedto} isn't an active agent in this company (no Agents row, or the person is deactivated)`); continue }

    const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId, clientOrgId: ticket.clientorgid })

    if (warningDue(state)) {
      const marked = await pool.query(
        "UPDATE Tickets SET slaWarningSentAt = NOW() WHERE id = $1 AND status = 'Open/Assigned' AND slaWarningSentAt IS NULL",
        [ticket.id]
      )
      note(ticket, `Close to its SLA (${activeHours.toFixed(1)} of ${maxHours} business hours)${marked.rowCount > 0 ? ': heads-up sent to ' + assignee.name : ': heads-up already sent'}`)
      if (marked.rowCount > 0) {
        sendEmail(
          assignee.email,
          `Heads-up: Ticket ${ticket.ticketid} is close to its SLA`,
          shell('This ticket is close to breaching its SLA', `
            <p>Ticket <strong>${ticket.ticketid}</strong> has used most of its ${maxHours} business-hour SLA. If it isn't resolved in time it will escalate to the next level.</p>
            ${ticketTable(ticket)}
          `, '#D97706'),
          null,
          replyFromAddress
        )
      }
      continue
    }

    if (!escalationDue(state)) {
      note(ticket, state.escalatedCount > 0
        ? `Escalated ${state.escalatedCount} time(s) already; next at ${(maxHours * (state.escalatedCount + 1)).toFixed(1)} business hours (now ${activeHours.toFixed(1)})`
        : `Within its SLA: ${activeHours.toFixed(1)} of ${maxHours} business hours used`)
      continue
    }

    const target = isSupplier(assignee) ? null : chooseEscalationTarget({
      agents: agents.filter(a => !isSupplier(a)),
      tickets,
      currentAssignee: assignee,
      category: ticket.category,
      levels,
      maxLevelId: routing?.maxlevelid ?? null
    })

    if (!target) {
      const ceiling = levels.find(l => Number(l.id) === Number(routing?.maxlevelid))?.name || 'the top level'
      const ownLevel = levels.some(l => l.name === assignee.level) ? assignee.level : `"${assignee.level}", which isn't one of your levels`
      note(ticket, isSupplier(assignee)
        ? `SLA breached but it's with ${assignee.name}, an outside supplier: superadmins alerted, not moved`
        : `SLA breached but ${assignee.name} is at ${ownLevel} and nobody above, up to ${ceiling}, has the ${ticket.category} category ticked: superadmins alerted, not moved`)
      const marked = await pool.query(
        "UPDATE Tickets SET escalationAlertSentAt = NOW() WHERE id = $1 AND status = 'Open/Assigned' AND escalationAlertSentAt IS NULL",
        [ticket.id]
      )
      if (marked.rowCount > 0 && adminEmails) {
        const why = isSupplier(assignee)
          ? `It's with ${escapeHtml(assignee.name)}, an outside supplier, so it can't be escalated automatically.`
          : `${escapeHtml(assignee.name)} is already at the highest level it can escalate to, or nobody above them covers the ${escapeHtml(ticket.category)} category.`
        sendEmail(
          adminEmails,
          `SLA breached: Ticket ${ticket.ticketid} needs attention`,
          shell('A ticket has breached its SLA', `
            <p>Ticket <strong>${ticket.ticketid}</strong> has passed its ${maxHours} business-hour SLA. ${why}</p>
            ${ticketTable(ticket, `<tr><td style="padding: 8px; background: #f4f7fb;"><strong>Assigned to</strong></td><td style="padding: 8px;">${escapeHtml(assignee.name)}</td></tr>`)}
          `, '#DC2626'),
          null,
          replyFromAddress
        )
      }
      continue
    }

    const moved = await pool.query(
      `UPDATE Tickets SET assignedTo = $1, escalatedCount = escalatedCount + 1, escalatedAt = NOW()
       WHERE id = $2 AND status = 'Open/Assigned' AND assignedTo = $3 AND escalatedCount = $4`,
      [target.agent.name, ticket.id, assignee.name, state.escalatedCount]
    )
    if (moved.rowCount === 0) { note(ticket, 'Skipped: the ticket changed while escalating, will retry next run'); continue }
    note(ticket, `Escalated: ${assignee.name} (${assignee.level}) -> ${target.agent.name} (${target.level.name})`)
    // Keep the in-memory view current so the next ticket in this run
    // sees the new workload when picking who to escalate to.
    ticket.assignedto = target.agent.name
    ticket.escalatedcount = state.escalatedCount + 1

    // The ticket has already moved, so a problem writing the history
    // line (it's a free-text column of unknown width) must not stop the
    // emails or the rest of the run. Kept short for the same reason.
    try {
      await pool.query(
        'INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)',
        [ticket.id, `Escalated to ${target.agent.name}`.slice(0, 50), 'KrishaSure']
      )
    } catch (err) {
      console.error(`Escalation history not recorded for ${ticket.ticketid}:`, err.message)
    }

    sendEmail(
      target.agent.email,
      `Escalated to you: Ticket ${ticket.ticketid} (SLA breached)`,
      shell('A ticket was escalated to you', `
        <p>Ticket <strong>${ticket.ticketid}</strong> passed its ${maxHours} business-hour SLA with <strong>${escapeHtml(assignee.name)}</strong> and has been escalated to you as ${escapeHtml(target.level.name)}.</p>
        ${ticketTable(ticket, `<tr><td style="padding: 8px; background: #f4f7fb;"><strong>Client</strong></td><td style="padding: 8px;">${escapeHtml(ticket.clientemail)}</td></tr>`)}
      `, '#DC2626'),
      [assignee.email, adminEmails].filter(Boolean).join(','),
      replyFromAddress
    )
  }
}

module.exports = { runEscalations }
