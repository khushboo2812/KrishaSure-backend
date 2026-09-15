const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken, requirePlatformOwner } = require('../middleware/auth')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

// GET all companies
router.get('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Companies ORDER BY createdAt DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create new company + its first superadmin.
//
// If adminEmail already belongs to an existing Person and the caller
// didn't pass linkExistingPersonId, don't silently create a duplicate
// identity and don't silently link them either — return 409 with that
// person's existing memberships so the platform owner can choose to
// link them as the new company's superadmin (retry this same call with
// linkExistingPersonId set) or cancel. Linking never creates a new
// password or sends the verification/welcome email, since that
// person's credentials already exist.
router.post('/', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { companyName, adminName, adminEmail, tier, companyType, linkExistingPersonId } = req.body

    let personId = linkExistingPersonId || null
    let verificationToken = null

    if (!personId) {
      const existing = await pool.query('SELECT id, name, email FROM People WHERE email = $1', [adminEmail])
      if (existing.rows.length > 0) {
        const person = existing.rows[0]
        const membershipsResult = await pool.query(
          `SELECT m.id, m.role, m.companyId, c.name AS companyName
           FROM Memberships m JOIN Companies c ON m.companyId = c.id
           WHERE m.personId = $1
           ORDER BY c.name`,
          [person.id]
        )
        return res.status(409).json({
          error: 'A person with this email already exists',
          existingPerson: { id: person.id, name: person.name, email: person.email },
          existingMemberships: membershipsResult.rows.map(r => ({
            membershipId: r.id, role: r.role, companyId: r.companyid, companyName: r.companyname
          }))
        })
      }
    }

    const companyResult = await pool.query(
      'INSERT INTO Companies (name, tier, databaseType, companyType) VALUES ($1, $2, $3, $4) RETURNING id',
      [companyName, tier || 'starter', 'shared', companyType || 'internal']
    )
    const companyId = companyResult.rows[0].id

    if (!personId) {
      const throwawayPassword = generateTempPassword()
      const hashedPassword = await bcrypt.hash(throwawayPassword, 10)
      verificationToken = generateTempPassword() + generateTempPassword()

      const personResult = await pool.query(
        `INSERT INTO People (name, email, password, mustChangePassword, emailVerified, verificationToken, verificationTokenExpiry)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours') RETURNING id`,
        [adminName, adminEmail, hashedPassword, true, false, verificationToken]
      )
      personId = personResult.rows[0].id
    }

    await pool.query(
      'INSERT INTO Memberships (personId, companyId, role) VALUES ($1, $2, $3)',
      [personId, companyId, 'superadmin']
    )

    await pool.query(
      `INSERT INTO Categories (name, description, companyId) VALUES
       ($1, $2, $3), ($4, $5, $3), ($6, $7, $3), ($8, $9, $3)`,
      ['Network', 'Network and connectivity issues', companyId,
       'Software', 'Software and application issues',
       'Hardware', 'Hardware and equipment issues',
       'Email', 'Email and communication issues']
    )

    await pool.query(
      `INSERT INTO SLARules (priority, categoryId, maxHours, companyId) VALUES
       ($1, NULL, $2, $3), ($4, NULL, $5, $3), ($6, NULL, $7, $3), ($8, NULL, $9, $3)`,
      ['Urgent', 2, companyId, 'High', 8, 'Medium', 24, 'Low', 72]
    )

    if (verificationToken) {
      sendEmail(
        adminEmail,
        'Verify your email - KrishaSure 📧',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0A2540;">Verify Your Email</h1>
            <p>Hi ${adminName},</p>
            <p>Your company account for <strong>${companyName}</strong> is almost ready. Please verify your email address to activate it.</p>
            <a href="https://api.krishasure.io/api/users/verify/${verificationToken}" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verify My Email</a>
            <br/><br/>
            <p style="color: #DC2626; font-size: 13px; font-weight: 600;">⏰ This link is valid for 24 hours only!!</p>
            <p style="color: #64748B; font-size: 12px;">Once verified, you'll receive your login credentials in a separate email.</p>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
    }

    res.status(201).json({
      message: verificationToken
        ? 'Company created successfully!! Verification email sent!!'
        : 'Company created successfully!! Existing account linked as superadmin.',
      companyId
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST resend welcome email for a company's admin
router.post('/:id/resend-welcome', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { id } = req.params

    const companyResult = await pool.query('SELECT * FROM Companies WHERE id = $1', [id])
    const company = companyResult.rows[0]

    const adminResult = await pool.query(
      `SELECT p.* FROM Memberships m JOIN People p ON m.personId = p.id
       WHERE m.companyId = $1 AND m.role = 'superadmin'`,
      [id]
    )
    const admin = adminResult.rows[0]

    if (!admin) {
      return res.status(404).json({ error: 'Company admin not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE People SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, admin.id]
    )

    sendEmail(
      admin.email,
      `Welcome to KrishaSure - ${company.name}!! 🎉`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${admin.name},</p>
          <p><strong>Email:</strong> ${admin.email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.json({ message: 'Welcome email resent successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT toggle a company's active status. The company and all its data
// stay completely intact either way — this only gates login (see
// routes/auth.js) and mid-session access (see middleware/auth.js),
// plus inbound email ticket creation (see routes/inboundEmail.js).
// platform_owner is exempt from all of those gates everywhere else in
// this app, so toggling isActive here never affects a platform owner's
// own access, including to whichever company they belong to.
router.put('/:id/active', authenticateToken, requirePlatformOwner, async (req, res) => {
  try {
    const { id } = req.params
    const { isActive } = req.body

    const result = await pool.query(
      'UPDATE Companies SET isActive = $1 WHERE id = $2 RETURNING id, name, isActive',
      [isActive, id]
    )
    const company = result.rows[0]
    if (!company) {
      return res.status(404).json({ error: 'Company not found' })
    }

    res.json({ message: `${company.name} ${isActive ? 'reactivated' : 'disabled'} successfully!!`, isActive: company.isactive })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
