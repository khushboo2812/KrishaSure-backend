const SUPPORT_EMAIL_DOMAIN = 'krishasure.io'

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'client'
}

// Companies and ClientOrganizations both get their own dedicated address
// on the one shared, verified krishasure.io domain, so uniqueness has to
// be checked across BOTH tables, not just the one a given caller is
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
