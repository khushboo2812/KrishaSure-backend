// In the UAT (test) environment no email may reach a real person by
// accident. Every recipient is checked against UAT_EMAIL_ALLOWLIST
// (comma-separated: full addresses, or "@domain.com" to allow a whole
// domain). Anyone not on the list is dropped, and if nobody is left
// the email isn't sent at all. Subjects get a "[UAT] " prefix so a test
// email is never mistaken for a real one.
//
// Production is untouched: outside UAT this returns the email as is.
const splitList = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean)

// you+admin@gmail.com is the same mailbox as you@gmail.com, so an exact
// rule for the second also allows the first (handy: one real inbox can
// stand in for every test user).
const withoutPlusTag = (address) => address.replace(/\+[^@]*@/, '@')

function isAllowed(address, allowlist) {
  const a = address.toLowerCase()
  return allowlist.some(rule => {
    const r = rule.toLowerCase()
    return r.startsWith('@') ? a.endsWith(r) : (a === r || withoutPlusTag(a) === r)
  })
}

function guardEmail({ isUat, allowlist, to, cc, subject }) {
  if (!isUat) return { send: true, to, cc, subject, dropped: [] }

  const rules = splitList(allowlist)
  const dropped = []
  const keep = (value) => splitList(value).filter(addr => {
    if (isAllowed(addr, rules)) return true
    dropped.push(addr)
    return false
  })

  const keptTo = keep(to)
  const keptCc = keep(cc)
  return {
    send: keptTo.length > 0,
    to: Array.isArray(to) ? keptTo : keptTo.join(','),
    cc: cc ? keptCc.join(',') || null : cc,
    subject: `[UAT] ${subject}`,
    dropped
  }
}

module.exports = { guardEmail, isAllowed, splitList }
