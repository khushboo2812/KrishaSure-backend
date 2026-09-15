const crypto = require('crypto')

// Verification links embed this token directly in a URL path
// (/api/users/verify/<token>). generateTempPassword()'s charset (used
// for actual login passwords, where symbols are a feature) includes
// '#' — a URL fragment delimiter. A browser strips everything from '#'
// onward before the request is ever sent, so any generated token
// containing one silently truncates on click, and the server never
// sees the full token: "Invalid or expired verification link" on a
// link that was never actually used. Hex is fully URL-safe by
// construction, so this can't happen.
function generateVerificationToken() {
  return crypto.randomBytes(24).toString('hex')
}

module.exports = { generateVerificationToken }
