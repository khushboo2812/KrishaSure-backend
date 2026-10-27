// In the UAT (test) environment no email may reach a real person by
// accident. UAT_EMAIL_ALLOWLIST is a comma-separated list of full
// addresses, or "@domain.com" to allow a whole domain.
//
//   * Recipients on the list get the email as normal.
//   * Anyone else is NOT emailed. Their email is redirected to the first
//     full address on the list instead, with a yellow note at the top
//     saying who it was meant for. So every email UAT would have sent
//     can be read in your own inbox, whoever it was for.
//   * With only "@domain" rules there is no inbox to redirect to, so
//     those emails are dropped (logged, not sent).
//
// Subjects get a "[UAT] " prefix so a test email is never mistaken for
// a real one. Production is untouched: outside UAT the email is returned
// as is.
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

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function guardEmail({ isUat, allowlist, to, cc, subject, html }) {
  if (!isUat) return { send: true, to, cc, subject, html, dropped: [], redirected: [] }

  const rules = splitList(allowlist)
  const inbox = rules.find(r => !r.startsWith('@')) || null
  const intended = []
  const keep = (value) => splitList(value).filter(addr => {
    if (isAllowed(addr, rules)) return true
    intended.push(addr)
    return false
  })

  const keptTo = keep(to)
  const keptCc = keep(cc)
  const finalTo = inbox && intended.length > 0 && !keptTo.some(a => a.toLowerCase() === inbox.toLowerCase())
    ? [...keptTo, inbox]
    : keptTo

  const redirected = inbox ? intended : []
  const dropped = inbox ? [] : intended
  const forNote = redirected.length > 0
    ? `(for ${redirected[0]}${redirected.length > 1 ? ` +${redirected.length - 1}` : ''}) `
    : ''
  const banner = redirected.length > 0
    ? `<div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 6px; padding: 10px 12px; margin: 0 0 16px 0; font-family: Arial, sans-serif; font-size: 13px; color: #0A2540;"><strong>UAT test email.</strong> This was meant for ${redirected.map(escapeHtml).join(', ')}. UAT sends it to you instead, so nobody else receives it.</div>`
    : ''

  return {
    send: finalTo.length > 0,
    to: Array.isArray(to) ? finalTo : finalTo.join(','),
    cc: cc ? keptCc.join(',') || null : cc,
    subject: `[UAT] ${forNote}${subject}`,
    html: banner + (html || ''),
    dropped,
    redirected
  }
}

module.exports = { guardEmail, isAllowed, splitList }
