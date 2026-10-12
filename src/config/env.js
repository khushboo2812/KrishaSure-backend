require('dotenv').config()

// Everything that differs between production and a test environment
// (UAT) lives here, so no web address is hard-coded anywhere else.
// Every default is the production value: with none of these variables
// set, the app behaves exactly as it always has.
//
//   APP_ENV              'production' (default) or 'uat'
//   APP_URL              where the web app lives (links in emails)
//   API_URL              where this API lives (verification links)
//   SUPPORT_EMAIL_DOMAIN domain of the generated support addresses
const trimSlash = (url) => String(url).replace(/\/+$/, '')

const APP_ENV = (process.env.APP_ENV || 'production').toLowerCase()

module.exports = {
  APP_ENV,
  IS_UAT: APP_ENV === 'uat',
  APP_URL: trimSlash(process.env.APP_URL || 'https://app.krishasure.io'),
  API_URL: trimSlash(process.env.API_URL || 'https://api.krishasure.io'),
  SUPPORT_EMAIL_DOMAIN: process.env.SUPPORT_EMAIL_DOMAIN || 'tickets.krishasure.io'
}
