const { Resend } = require('resend')
require('dotenv').config()

const { IS_UAT } = require('./env')
const { guardEmail } = require('../utils/emailGuard')

const resend = new Resend(process.env.RESEND_API_KEY)

const sendEmail = async (to, subject, html, cc = null, fromAddress = null) => {
  try {
    // In UAT nothing reaches a real person: mail for anyone not on the
    // allow-list is redirected to the allow-list inbox (see emailGuard).
    const guarded = guardEmail({ isUat: IS_UAT, allowlist: process.env.UAT_EMAIL_ALLOWLIST, to, cc, subject, html })
    if (!guarded.send) {
      console.log(`[UAT] Email not sent, nobody on UAT_EMAIL_ALLOWLIST to receive it (meant for: ${guarded.dropped.join(', ')}): ${subject}`)
      return
    }
    if (guarded.redirected.length > 0) console.log(`[UAT] Redirected to the allow-list inbox, meant for: ${guarded.redirected.join(', ')}`)
    to = guarded.to; cc = guarded.cc; subject = guarded.subject; html = guarded.html

    const emailData = {
      from: `KrishaSure <${fromAddress || process.env.EMAIL_FROM}>`,
      to,
      subject,
      html
    }
    if (cc) {
      emailData.cc = cc.split(',')
    }
    await resend.emails.send(emailData)
    console.log(`Email sent to ${to}`)
  } catch (err) {
    console.error('Email failed:', err.message)
  }
}

module.exports = { sendEmail }