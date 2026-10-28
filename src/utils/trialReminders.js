const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { getNotificationRecipients } = require('./usageLimits')
const { EMAIL_LOGO } = require('./emailBranding')
const { REMINDER_DAYS_BEFORE_END, trialDaysLeft } = require('./trial')

function wrap(title, bodyHtml) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${EMAIL_LOGO}
      <h1 style="color: #0A2540;">${title}</h1>
      ${bodyHtml}
      <br/>
      <p style="color: #64748B; font-size: 12px;">KrishaSure · Powered by Krisha Solutions</p>
    </div>
  `
}

// Each email goes out once per trial: the row is marked first
// (UPDATE ... RETURNING only returns rows it actually changed), then
// the email is sent, so two overlapping runs can't both send it. The
// markers are cleared when a trial is started or extended
// (routes/companies.js), which gives the new end date its own emails.
async function sendTrialEmails(rows, { title, body }) {
  for (const company of rows) {
    const { to, cc } = await getNotificationRecipients(company.id)
    if (!to) continue
    sendEmail(to, title(company), wrap(title(company), body(company)), cc)
  }
}

async function runTrialReminders() {
  const reminders = await pool.query(
    `UPDATE Companies SET trialReminderSentAt = NOW()
     WHERE isActive = true AND trialEndsAt IS NOT NULL AND trialReminderSentAt IS NULL
       AND trialEndsAt > NOW() AND trialEndsAt <= NOW() + ($1 || ' days')::interval
     RETURNING id, name, trialEndsAt`,
    [String(REMINDER_DAYS_BEFORE_END)]
  )
  await sendTrialEmails(reminders.rows, {
    title: c => `${c.name}'s free trial ends soon`,
    body: c => {
      const days = trialDaysLeft(c.trialendsat)
      return `<p>The free trial for <strong>${c.name}</strong> ends in <strong>${days} day${days === 1 ? '' : 's'}</strong>, on ${new Date(c.trialendsat).toDateString()}.</p>
        <p>After that its users won't be able to sign in until the trial is extended or the account is moved to a paid plan.</p>`
    }
  })

  const ended = await pool.query(
    `UPDATE Companies SET trialEndedNotifiedAt = NOW()
     WHERE isActive = true AND trialEndsAt IS NOT NULL AND trialEndedNotifiedAt IS NULL
       AND trialEndsAt <= NOW()
     RETURNING id, name`
  )
  await sendTrialEmails(ended.rows, {
    title: c => `${c.name}'s free trial has ended`,
    body: c => `<p>The free trial for <strong>${c.name}</strong> has ended, so its users can no longer sign in.</p>
      <p>You can extend the trial or move the company to a paid plan from the Platform Dashboard's Companies tab.</p>`
  })
}

module.exports = { runTrialReminders }
