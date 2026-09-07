const { Resend } = require('resend')
require('dotenv').config()

const resend = new Resend(process.env.RESEND_API_KEY)

const sendEmail = async (to, subject, html, cc = null) => {
  try {
    const emailData = {
      from: `KrishaSure <${process.env.EMAIL_FROM}>`,
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