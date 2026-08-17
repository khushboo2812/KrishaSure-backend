const { Resend } = require('resend')
require('dotenv').config()

const resend = new Resend(process.env.RESEND_API_KEY)

const sendEmail = async (to, subject, html) => {
  try {
    await resend.emails.send({
      from: `KrishaSure <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html
    })
    console.log(`Email sent to ${to}`)
  } catch (err) {
    console.error('Email failed:', err.message)
  }
}

module.exports = { sendEmail }