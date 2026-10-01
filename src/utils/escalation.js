const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getTicketReplyFromAddress } = require('./supportEmail')
const { activeBusinessHours, getEffectiveBusinessHours } = require('./businessHours')
const { resolveSlaRule, getCompanyBusinessHours, getClientOrgBusinessHoursById, getCategoryNameToId, getCompanySlaRules } = require('./slaData')
const { getCompanyLevels } = require('./agentLevels')
const { chooseEscalationTarget, escalationDue, warningDue, isSupplier } = require('./assignment')
const { escapeHtml } = require('./commentNotifications')

function shell(heading, bodyHtml, color = '#0A2540') {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: ${color};">${heading}</h1>
      ${bodyHtml}
      <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
      <br/><br/>
      <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
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
async function runEscalations(now = new Date()) {
  const companies = await pool.query('SELECT id, name FROM Companies WHERE escalationEnabled = true AND isActive = true')
  for (const company of companies.rows) {
    try {
      await escalateCompany(company, now)
    } catch (err) {
      console.error(`Escalation failed for ${company.name}:`, err.message)
    }
  }
}

async function escalateCompany(company, now) {
  const companyId = company.id
  const [levels, routingResult, slaRules, categoryNameToId, companyHours, orgHours] = await Promise.all([
    getCompanyLevels(companyId),
    pool.query('SELECT priority, escalate, maxLevelId FROM PriorityRouting WHERE companyId = $1', [companyId]),
    getCompanySlaRules(companyId),
    getCategoryNameToId(companyId),
    getCompanyBusinessHours(companyId),
    getClientOrgBusinessHoursById(companyId)
  ])
  if (levels.length === 0) return
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

  const adminsResult = await pool.query(
    "SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role = 'superadmin' AND m.companyId = $1 AND m.isActive = true",
    [companyId]
  )
  const adminEmails = adminsResult.rows.map(a => a.email).join(',')

  for (const ticket of candidates) {
    const routing = routingByPriority[ticket.priority]
    if (routing && routing.escalate === false) continue

    const rule = resolveSlaRule(ticket, slaRules, categoryNameToId)
    if (!rule || rule.maxhours === null) continue
    const maxHours = Number(rule.maxhours)

    const effective = getEffectiveBusinessHours(companyHours, orgHours?.[ticket.clientorgid])
    const activeHours = activeBusinessHours(ticket, now, effective)
    const state = { activeHours, maxHours, escalatedCount: ticket.escalatedcount || 0 }
    const assignee = agents.find(a => a.name === ticket.assignedto)
    if (!assignee) continue

    const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId, clientOrgId: ticket.clientorgid })

    if (warningDue(state)) {
      const marked = await pool.query(
        "UPDATE Tickets SET slaWarningSentAt = NOW() WHERE id = $1 AND status = 'Open/Assigned' AND slaWarningSentAt IS NULL",
        [ticket.id]
      )
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

    if (!escalationDue(state)) continue

    const target = isSupplier(assignee) ? null : chooseEscalationTarget({
      agents: agents.filter(a => !isSupplier(a)),
      tickets,
      currentAssignee: assignee,
      category: ticket.category,
      levels,
      maxLevelId: routing?.maxlevelid ?? null
    })

    if (!target) {
      const marked = await pool.query(
        "UPDATE Tickets SET escalationAlertSentAt = NOW() WHERE id = $1 AND status = 'Open/Assigned' AND escalationAlertSentAt IS NULL",
        [ticket.id]
      )
      if (marked.rowCount > 0 && adminEmails) {
        const why = isSupplier(assignee)
          ? `It's with ${escapeHtml(assignee.name)}, an outside supplier, so it can't be escalated automatically.`
          : `${escapeHtml(assignee.name)} is already at the highest level it can escalate to.`
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
    if (moved.rowCount === 0) continue
    // Keep the in-memory view current so the next ticket in this run
    // sees the new workload when picking who to escalate to.
    ticket.assignedto = target.agent.name
    ticket.escalatedcount = state.escalatedCount + 1

    await pool.query(
      'INSERT INTO TicketHistory (ticketId, action, performedBy) VALUES ($1, $2, $3)',
      [ticket.id, `Escalated from ${assignee.name} to ${target.agent.name} (${target.level.name}) — SLA breached`, 'KrishaSure']
    )

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
