const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../config/db')
const { authenticateToken, INACTIVE_COMPANY_MESSAGE, INACTIVE_MEMBERSHIP_MESSAGE } = require('../middleware/auth')

const JWT_SECRET = process.env.JWT_SECRET || 'krishasure_secret'

async function getMemberships(personId) {
  const result = await pool.query(
    `SELECT m.id, m.role, m.companyId, m.clientOrgId, c.name AS companyName, c.isActive AS companyActive, m.isActive AS membershipActive
     FROM Memberships m
     JOIN Companies c ON m.companyId = c.id
     WHERE m.personId = $1
     ORDER BY c.name`,
    [personId]
  )
  return result.rows.map(r => ({
    membershipId: r.id,
    role: r.role,
    companyId: r.companyid,
    companyName: r.companyname,
    clientOrgId: r.clientorgid,
    companyActive: r.companyactive,
    membershipActive: r.membershipactive,
    // platform_owner is exempt from company-active AND membership-active
    // gating everywhere else in this app, so treat their membership as
    // always usable too.
    usable: r.role === 'platform_owner' || (r.companyactive && r.membershipactive)
  }))
}

// Full, normal-session JWT + the user object the frontend stores. Used
// after a single-membership login, after selecting a membership at
// login, and after switching membership later — always the same shape,
// so the rest of the app (every req.user.role/companyId/clientOrgId/
// email/name read) never has to know which of the three produced it.
function issueSession(person, membership, memberships) {
  const token = jwt.sign(
    {
      personId: person.id,
      membershipId: membership.membershipId,
      email: person.email,
      name: person.name,
      role: membership.role,
      companyId: membership.companyId,
      clientOrgId: membership.clientOrgId
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  )

  return {
    token,
    mustChangePassword: person.mustchangepassword,
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      role: membership.role,
      companyId: membership.companyId,
      companyName: membership.companyName,
      clientOrgId: membership.clientOrgId,
      membershipId: membership.membershipId,
      memberships
    }
  }
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    const result = await pool.query('SELECT * FROM People WHERE LOWER(email) = LOWER($1)', [email])
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const person = result.rows[0]
    const isMatch = await bcrypt.compare(password, person.password)
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const memberships = await getMemberships(person.id)

    if (memberships.length === 0) {
      return res.status(403).json({ error: 'This account has no company access. Contact your administrator.' })
    }

    // A membership in a disabled company isn't offered as a login
    // option at all — filtered out here rather than shown and left to
    // fail if picked, same principle as the mid-session gate in
    // middleware/auth.js applied one step earlier.
    const usableMemberships = memberships.filter(m => m.usable)

    if (usableMemberships.length === 0) {
      // Could be unusable because the company is disabled, because this
      // specific membership was deactivated, or a mix across several —
      // company-inactive is the more actionable thing to surface if
      // either applies to any of them.
      const anyCompanyInactive = memberships.some(m => m.companyActive === false)
      return res.status(403).json({ error: anyCompanyInactive ? INACTIVE_COMPANY_MESSAGE : INACTIVE_MEMBERSHIP_MESSAGE })
    }

    if (usableMemberships.length === 1) {
      return res.json(issueSession(person, usableMemberships[0], memberships))
    }

    // More than one usable membership: don't issue a full session token
    // yet — the frontend needs to show a picker first. This short-lived
    // token only proves "this is person X, already password-verified"
    // to /select-membership, so the password never needs to be re-sent.
    const selectToken = jwt.sign({ personId: person.id, purpose: 'select-membership' }, JWT_SECRET, { expiresIn: '5m' })
    res.json({ requiresMembershipSelection: true, selectToken, memberships: usableMemberships })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/select-membership', async (req, res) => {
  try {
    const { selectToken, membershipId } = req.body
    if (!selectToken || !membershipId) {
      return res.status(400).json({ error: 'selectToken and membershipId are required' })
    }

    let decoded
    try {
      decoded = jwt.verify(selectToken, JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Selection expired — please log in again' })
    }
    if (decoded.purpose !== 'select-membership') {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [decoded.personId])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const memberships = await getMemberships(person.id)
    const chosen = memberships.find(m => m.membershipId === membershipId)
    if (!chosen) {
      return res.status(403).json({ error: 'That membership does not belong to this account' })
    }
    if (!chosen.usable) {
      return res.status(403).json({ error: chosen.companyActive === false ? INACTIVE_COMPANY_MESSAGE : INACTIVE_MEMBERSHIP_MESSAGE })
    }

    res.json(issueSession(person, chosen, memberships))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Switch to a different one of the caller's own memberships without a
// fresh login. Requires a normal, already-valid session token (unlike
// select-membership above, which only proves password-verified
// identity right after login) — this is a convenience for moving
// between your own verified memberships, not a re-authentication step.
// Always issues a real new JWT for the target membership; it does not
// fake the role client-side the way PlatformDashboard's "View My
// Company" does, which is exactly the pattern that turned out to break
// against any route that actually checks role.
router.post('/switch-membership', authenticateToken, async (req, res) => {
  try {
    const { membershipId } = req.body
    if (!membershipId) {
      return res.status(400).json({ error: 'membershipId is required' })
    }

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [req.user.personId])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const memberships = await getMemberships(person.id)
    const chosen = memberships.find(m => m.membershipId === membershipId)
    if (!chosen) {
      return res.status(403).json({ error: 'That membership does not belong to this account' })
    }
    // authenticateToken already confirmed the *current* session's
    // company is active (or the caller is platform_owner) — this
    // covers the *target* membership being switched into, which could
    // belong to a different, disabled company.
    if (!chosen.usable) {
      return res.status(403).json({ error: chosen.companyActive === false ? INACTIVE_COMPANY_MESSAGE : INACTIVE_MEMBERSHIP_MESSAGE })
    }

    res.json(issueSession(person, chosen, memberships))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
