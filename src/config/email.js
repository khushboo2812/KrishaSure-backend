const nodemailer = require('nodemailer')
require('dotenv').config()

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
})

const sendEmail = async (to, subject, html) => {
  try {
    await transporter.sendMail({
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