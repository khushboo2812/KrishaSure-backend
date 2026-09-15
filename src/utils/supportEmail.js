// The root krishasure.io domain's MX records point at GoDaddy's real
// mail hosting (staff mailboxes) — routing generated addresses there
// bounces before ever reaching Resend. tickets.krishasure.io is a
// dedicated subdomain, unused for anything else, fully verified in
// Resend for both inbound receiving (MX -> Resend's AWS SES inbound
// endpoint) and outbound sending (DKIM/SPF), so it doesn't touch or
// depend on the root domain's mail at all.
const SUPPORT_EMAIL_DOMAIN = 'tickets.krishasure.io'

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'client'
}

// Companies and ClientOrganizations both get their own dedicated address
// on the one shared SUPPORT_EMAIL_DOMAIN, so uniqueness has to be
// checked across BOTH tables, not just the one a given caller is
// generating for. Collisions (two entities whose names slugify the same)
// get a numeric suffix rather than being rejected, since names are never
// required to be unique.
async function generateSupportEmail(pool, name) {
  const base = slugify(name)
  let candidate = `${base}-support@${SUPPORT_EMAIL_DOMAIN}`
  let suffix = 2
  while (true) {
    const [orgs, companies] = await Promise.all([
      pool.query('SELECT id FROM ClientOrganizations WHERE supportEmail = $1', [candidate]),
      pool.query('SELECT id FROM Companies WHERE supportEmail = $1', [candidate])
    ])
    if (orgs.rows.length === 0 && companies.rows.length === 0) return candidate
    candidate = `${base}-support-${suffix}@${SUPPORT_EMAIL_DOMAIN}`
    suffix++
  }
}

module.exports = { SUPPORT_EMAIL_DOMAIN, slugify, generateSupportEmail }
