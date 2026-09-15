const jwt = require('jsonwebtoken')
const { pool } = require('../config/db')

// Shared wording so login, mid-session enforcement, and inbound email
// all say the same thing about a disabled company.
const INACTIVE_COMPANY_MESSAGE = "This company's account is currently inactive — contact your platform administrator"

// Verifies the JWT, then — unless the caller is platform_owner, who is
// always exempt — checks that the token's company is still active.
// This runs on every authenticated request (every route uses this
// middleware), so disabling a company takes effect immediately for
// anyone already signed in, not just on their next login. platform_owner
// must stay exempt: they're the only role that can re-enable a disabled
// company, so nothing should be able to lock them out — including a
// session issued while impersonating a company via PlatformDashboard's
// "View My Company", which never swaps the underlying token's role.
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  jwt.verify(token, process.env.JWT_SECRET || 'krishasure_secret', async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' })
    }

    if (user.role !== 'platform_owner') {
      try {
        const result = await pool.query('SELECT isActive FROM Companies WHERE id = $1', [user.companyId])
        const company = result.rows[0]
        if (!company || !company.isactive) {
          return res.status(403).json({ error: INACTIVE_COMPANY_MESSAGE })
        }
      } catch (dbErr) {
        return res.status(500).json({ error: dbErr.message })
      }
    }

    req.user = user
    next()
  })
}

function requirePlatformOwner(req, res, next) {
  if (req.user.role !== 'platform_owner') {
    return res.status(403).json({ error: 'Access denied' })
  }
  next()
}

module.exports = { authenticateToken, requirePlatformOwner, INACTIVE_COMPANY_MESSAGE }
