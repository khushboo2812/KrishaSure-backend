const jwt = require('jsonwebtoken')

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  jwt.verify(token, process.env.JWT_SECRET || 'krishasure_secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' })
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

module.exports = { authenticateToken, requirePlatformOwner }