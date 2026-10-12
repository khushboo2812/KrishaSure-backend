const { Resend } = require('resend')
require('dotenv').config()

const { IS_UAT } = require('./env')
const { guardEmail } = require('../utils/emailGuard')

const resend = new Resend(process.env.RESEND_API_KEY)

const sendEmail = async (to, subject, html, cc = null, fromAddress = null) => {
  try {
    // In UAT only allow-listed recipients get anything (see emailGuard).
    const guarded = guardEmail({ isUat: IS_UAT, allowlist: process.env.UAT_EMAIL_ALLOWLIST, to, cc, subject })
    if (!guarded.send) {
      console.log(`[UAT] Email blocked, no allow-listed recipient (dropped: ${guarded.dropped.join(', ')}): ${subject}`)
      return
    }
    if (guarded.dropped.length > 0) console.log(`[UAT] Dropped recipients: ${guarded.dropped.join(', ')}`)
    to = guarded.to; cc = guarded.cc; subject = guarded.subject

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