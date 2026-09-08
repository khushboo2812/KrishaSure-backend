const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query('SELECT id, name, email, role, createdAt FROM Users WHERE companyId = $1', [companyId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, email, role, level, skills, clientOrgId } = req.body

    const existing = await pool.query('SELECT id FROM Users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists!!' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)
    const verificationToken = generateTempPassword() + generateTempPassword()

    
 await pool.query(
  `INSERT INTO Users (name, email, password, role, companyId, emailVerified, verificationToken, verificationTokenExpiry, clientOrgId) 
   VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours', $8)`,
  [name, email, hashedPassword, role, companyId, false, verificationToken, clientOrgId || null]
)

    if (role === 'agent') {
      await pool.query(
        'INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)',
        [name, email, level || 'Junior', skills || '', companyId]
      )
    }

    // Send VERIFICATION email first (not welcome email yet)
    sendEmail(
      email,
      'Verify your email - KrishaSure 📧',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Verify Your Email</h1>
          <p>Hi ${name},</p>
          <p>An account has been created for you on KrishaSure. Please verify your email address to activate your account.</p>
          <a href="https://api.krishasure.io/api/users/verify/${verificationToken}" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verify My Email</a>
          <br/><br/>
          <p style="color: #64748B; font-size: 12px;">Once verified, you'll receive your login credentials in a separate email.</p>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.status(201).json({ message: 'User created successfully!! Verification email sent!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET verify email
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params

    const result = await pool.query('SELECT * FROM Users WHERE verificationToken = $1', [token])
    
    if (result.rows.length === 0) {
      return res.status(400).send('<h1>Invalid or expired verification link</h1>')
    }

    const user = result.rows[0]

      
    if (new Date() > new Date(user.verificationtokenexpiry)) {
      return res.status(400).send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1 style="color: #DC2626;">⏰ Link Expired</h1>
          <p>This verification link has expired. Please contact your administrator for a new one.</p>
        </div>
      `)
    }

    await pool.query(
      'UPDATE Users SET emailVerified = true, verificationToken = NULL WHERE id = $1',
      [user.id]
    )

    // Now generate and send the actual temp password
    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, user.id]
    )

   sendEmail(
  email,
  'Verify your email - KrishaSure 📧',
  `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0A2540;">Verify Your Email</h1>
      <p>Hi ${name},</p>
      <p>An account has been created for you on KrishaSure. Please verify your email address to activate your account.</p>
      <a href="https://api.krishasure.io/api/users/verify/${verificationToken}" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verify My Email</a>
      <br/><br/>
      <p style="color: #DC2626; font-size: 13px; font-weight: 600;">⏰ This link is valid for 24 hours only!!</p>
      <p style="color: #64748B; font-size: 12px;">Once verified, you'll receive your login credentials in a separate email.</p>
      <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
    </div>
  `
)

    res.send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
        <h1 style="color: #16A34A;">✅ Email Verified!!</h1>
        <p>Check your inbox for your login credentials!!</p>
      </div>
    `)
  } catch (err) {
    res.status(500).send('<h1>Something went wrong</h1>')
  }
})

router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body
    const hashedPassword = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = false WHERE id = $2',
      [hashedPassword, id]
    )
    res.json({ message: 'Password updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/resend-welcome', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE Users SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, id]
    )

    sendEmail(
      user.email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${user.name},</p>
          <p><strong>Email:</strong> ${user.email}</p>
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

router.post('/:id/resend-verification', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.emailverified) {
      return res.status(400).json({ error: 'This user has already verified their email' })
    }

    const verificationToken = generateTempPassword() + generateTempPassword()

    await pool.query(
      "UPDATE Users SET verificationToken = $1, verificationTokenExpiry = NOW() + INTERVAL '24 hours' WHERE id = $2",
      [verificationToken, id]
    )

    sendEmail(
      user.email,
      'Verify your email - KrishaSure 📧',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Verify Your Email</h1>
          <p>Hi ${user.name},</p>
          <p>Please verify your email address to activate your KrishaSure account.</p>
          <a href="https://api.krishasure.io/api/users/verify/${verificationToken}" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verify My Email</a>
          <br/><br/>
          <p style="color: #DC2626; font-size: 13px; font-weight: 600;">⏰ This link is valid for 24 hours only!!</p>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `
    )

    res.json({ message: 'Verification email resent successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id/agent-details', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { level, skills } = req.body

    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]

    if (!user || user.role !== 'agent') {
      return res.status(400).json({ error: 'User is not an agent' })
    }

    await pool.query(
      'UPDATE Agents SET level = $1, skills = $2 WHERE email = $3 AND companyId = $4',
      [level, skills, user.email, companyId]
    )

    res.json({ message: 'Agent details updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const userResult = await pool.query('SELECT * FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    const user = userResult.rows[0]
    
    if (user && user.role === 'agent') {
      await pool.query('DELETE FROM Agents WHERE email = $1 AND companyId = $2', [user.email, companyId])
    }
    
    await pool.query('DELETE FROM Users WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'User deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router