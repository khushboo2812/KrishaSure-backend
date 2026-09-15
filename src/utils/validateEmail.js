// Mirrors the frontend's check (src/utils/validateEmail.js there) —
// not a full RFC 5322 validator, just enough to reject what actually
// slips through: no @, no domain, no dot in the domain, stray
// whitespace. The frontend already blocks these before submit; this is
// the server-side backstop for direct API calls.
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

module.exports = { isValidEmail }
