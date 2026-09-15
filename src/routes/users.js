const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { authenticateToken } = require('../middleware/auth')
const { getTicketReplyFromAddress } = require('../utils/supportEmail')
const { generateVerificationToken } = require('../utils/verificationToken')

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

async function getMembershipsForPerson(personId) {
  const result = await pool.query(
    `SELECT m.id, m.role, m.companyId, c.name AS companyName
     FROM Memberships m JOIN Companies c ON m.companyId = c.id
     WHERE m.personId = $1
     ORDER BY c.name`,
    [personId]
  )
  return result.rows.map(r => ({ membershipId: r.id, role: r.role, companyId: r.companyid, companyName: r.companyname }))
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const result = await pool.query(
      `SELECT p.id, m.id AS membershipId, p.name, p.email, m.role, p.createdAt, m.clientOrgId, p.emailVerified, p.mustChangePassword, c.name as clientOrgName, m.isActive
       FROM Memberships m
       JOIN People p ON m.personId = p.id
       LEFT JOIN ClientOrganizations c ON m.clientOrgId = c.id
       WHERE m.companyId = $1`,
      [companyId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { name, email, role, level, skills, clientOrgId, alsoAgent } = req.body

    // If this email already belongs to a real person, don't silently
    // create a duplicate identity and don't silently link them either —
    // hand the admin that person's existing memberships and let them
    // choose to link a new one (see POST /link-membership) or cancel.
    const existingPerson = await pool.query('SELECT id, name, email FROM People WHERE LOWER(email) = LOWER($1)', [email])
    if (existingPerson.rows.length > 0) {
      const person = existingPerson.rows[0]
      const existingMemberships = await getMembershipsForPerson(person.id)
      return res.status(409).json({
        error: 'A person with this email already exists',
        existingPerson: { id: person.id, name: person.name, email: person.email },
        existingMemberships
      })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)
    const verificationToken = generateVerificationToken()

    const personResult = await pool.query(
      `INSERT INTO People (name, email, password, emailVerified, verificationToken, verificationTokenExpiry)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours') RETURNING id`,
      [name, email, hashedPassword, false, verificationToken]
    )
    const personId = personResult.rows[0].id

    await pool.query(
      'INSERT INTO Memberships (personId, companyId, role, clientOrgId) VALUES ($1, $2, $3, $4)',
      [personId, companyId, role, clientOrgId || null]
    )

    if (role === 'agent' || (role === 'admin' && alsoAgent)) {
      await pool.query(
        'INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)',
        [name, email, level || 'Junior', skills || '', companyId]
      )
    }

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

    res.status(201).json({ message: 'User created successfully!! Verification email sent!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Link an existing Person to a new company/role — no new password, no
// welcome/verification email, since this person's credentials already
// exist. This is the "Link as new membership" action offered when
// POST / found an existing Person for the entered email.
router.post('/link-membership', authenticateToken, async (req, res) => {
  try {
    const { companyId } = req.user
    const { personId, role, clientOrgId, level, skills, alsoAgent } = req.body

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [personId])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'Person not found' })
    }

    const existingMembership = await pool.query(
      'SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2',
      [personId, companyId]
    )
    if (existingMembership.rows.length > 0) {
      return res.status(400).json({ error: 'This person is already a member of your company' })
    }

    await pool.query(
      'INSERT INTO Memberships (personId, companyId, role, clientOrgId) VALUES ($1, $2, $3, $4)',
      [personId, companyId, role, clientOrgId || null]
    )

    if (role === 'agent' || (role === 'admin' && alsoAgent)) {
      await pool.query(
        'INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)',
        [person.name, person.email, level || 'Junior', skills || '', companyId]
      )
    }

    res.status(201).json({ message: 'Membership linked successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET verify email - shows a confirmation page (does NOT verify yet)
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params

    const result = await pool.query('SELECT * FROM People WHERE verificationToken = $1', [token])

    if (result.rows.length === 0) {
      return res.status(400).send('<h1>Invalid or expired verification link</h1>')
    }

    const person = result.rows[0]

    if (new Date() > new Date(person.verificationtokenexpiry)) {
      return res.status(400).send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1 style="color: #DC2626;">⏰ Link Expired</h1>
          <p>This verification link has expired. Please contact your administrator for a new one.</p>
        </div>
      `)
    }

    res.send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
        <h1 style="color: #0A2540;">Confirm Your Email</h1>
        <p>Hi ${person.name}, click below to confirm ${person.email} and activate your KrishaSure account.</p>
        <form method="POST" action="https://api.krishasure.io/api/users/verify/${token}/confirm">
          <button type="submit" style="background: #00C2CB; color: #0A2540; padding: 14px 32px; border-radius: 8px; border: none; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 16px;">
            Confirm My Email
          </button>
        </form>
      </div>
    `)
  } catch (err) {
    res.status(500).send('<h1>Something went wrong</h1>')
  }
})

// POST confirm - this actually performs verification, only triggered by the button click
router.post('/verify/:token/confirm', async (req, res) => {
  try {
    const { token } = req.params

    const result = await pool.query('SELECT * FROM People WHERE verificationToken = $1', [token])

    if (result.rows.length === 0) {
      return res.status(400).send('<h1>Invalid or expired verification link</h1>')
    }

    const person = result.rows[0]

    if (new Date() > new Date(person.verificationtokenexpiry)) {
      return res.status(400).send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1 style="color: #DC2626;">⏰ Link Expired</h1>
          <p>This verification link has expired. Please contact your administrator for a new one.</p>
        </div>
      `)
    }

    await pool.query(
      'UPDATE People SET emailVerified = true, emailVerifiedAt = NOW(), verificationToken = NULL WHERE id = $1',
      [person.id]
    )

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE People SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, person.id]
    )

    sendEmail(
      person.email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Email Verified!! Welcome to KrishaSure!!</h1>
          <p>Hi ${person.name},</p>
          <p><strong>Email:</strong> ${person.email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>Please login and change your password immediately!!</p>
          <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Login to KrishaSure</a>
          <br/><br/>
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

// :id is a personId here — name lives on People, one canonical name
// across every company this person belongs to.
router.put('/:id/name', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { name } = req.body

    // Verify the acting admin's company actually has a membership for
    // this person before letting them rename a Person record — renaming
    // touches every company that person belongs to (via the Agents sync
    // below), so this must not be callable against an arbitrary
    // personId with no relationship to the caller's own company.
    const membership = await pool.query('SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2', [id, companyId])
    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [id])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'User not found' })
    }

    await pool.query('UPDATE People SET name = $1 WHERE id = $2', [name, id])

    // Name is a Person-level attribute now — keep every company's
    // Agents row for this person in sync (not just the acting
    // company's), so the same real person doesn't show a stale name in
    // ticket assignments elsewhere. This UPDATE simply matches zero rows
    // for a person who isn't an agent anywhere, so no role check is
    // needed first.
    await pool.query('UPDATE Agents SET name = $1 WHERE email = $2', [name, person.email])

    res.json({ message: 'Name updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST resend verification email
router.post('/:id/resend-verification', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const membership = await pool.query('SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2', [id, companyId])
    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [id])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (person.emailverified) {
      return res.status(400).json({ error: 'This user has already verified their email' })
    }

    const verificationToken = generateVerificationToken()

    await pool.query(
      "UPDATE People SET verificationToken = $1, verificationTokenExpiry = NOW() + INTERVAL '24 hours' WHERE id = $2",
      [verificationToken, id]
    )

    sendEmail(
      person.email,
      'Verify your email - KrishaSure 📧',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Verify Your Email</h1>
          <p>Hi ${person.name},</p>
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

// PUT reset password — :id is a personId. One password per person
// across every membership, so either you're changing your own, or an
// admin/superadmin is resetting it for someone who is actually a
// member of their own company (not an arbitrary personId anywhere on
// the platform — a shared credential now, so this check matters more
// than it used to).
router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body
    const { personId, companyId, role } = req.user

    const isOwnPassword = String(id) === String(personId)
    if (!isOwnPassword) {
      if (role !== 'superadmin' && role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' })
      }
      const membership = await pool.query('SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2', [id, companyId])
      if (membership.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' })
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE People SET password = $1, mustChangePassword = false WHERE id = $2',
      [hashedPassword, id]
    )
    res.json({ message: 'Password updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id/agent-details', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { level, skills } = req.body

    const result = await pool.query(
      `SELECT p.name, p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.personId = $1 AND m.companyId = $2`,
      [id, companyId]
    )
    const person = result.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'User not found' })
    }

    const existingAgent = await pool.query('SELECT id FROM Agents WHERE email = $1 AND companyId = $2', [person.email, companyId])

    if (existingAgent.rows.length > 0) {
      await pool.query(
        'UPDATE Agents SET level = $1, skills = $2 WHERE email = $3 AND companyId = $4',
        [level, skills, person.email, companyId]
      )
    } else {
      await pool.query(
        'INSERT INTO Agents (name, email, level, skills, companyId) VALUES ($1, $2, $3, $4, $5)',
        [person.name, person.email, level, skills, companyId]
      )
    }

    res.json({ message: 'Agent details updated successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/resend-welcome', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const membership = await pool.query('SELECT id FROM Memberships WHERE personId = $1 AND companyId = $2', [id, companyId])
    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    const personResult = await pool.query('SELECT * FROM People WHERE id = $1', [id])
    const person = personResult.rows[0]
    if (!person) {
      return res.status(404).json({ error: 'User not found' })
    }

    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    await pool.query(
      'UPDATE People SET password = $1, mustChangePassword = true WHERE id = $2',
      [hashedPassword, id]
    )

    sendEmail(
      person.email,
      'Welcome to KrishaSure!! 🎉',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Welcome to KrishaSure!!</h1>
          <p>Hi ${person.name},</p>
          <p><strong>Email:</strong> ${person.email}</p>
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

// DELETE — :id is a membershipId, not a personId. Removes only this
// person's membership in the acting admin's own company; the Person
// row (and any membership they hold in other companies) is left
// completely untouched, even if this was their last membership
// anywhere. An admin in one company must never be able to remove
// someone's access to a different company just by deleting them from
// their own user list.
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user

    const result = await pool.query(
      `SELECT m.id, m.role, p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.id = $1 AND m.companyId = $2`,
      [id, companyId]
    )
    const membership = result.rows[0]

    if (membership && membership.role === 'agent') {
      await pool.query('DELETE FROM Agents WHERE email = $1 AND companyId = $2', [membership.email, companyId])
    }

    await pool.query('DELETE FROM Memberships WHERE id = $1 AND companyId = $2', [id, companyId])
    res.json({ message: 'User removed from this company successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT toggle a membership's active status. Scenario: someone leaves the
// company. Unlike deleting the membership (which forgets who they even
// were here), this preserves history while cutting off access — gated
// at login and mid-session (see auth.js/middleware/auth.js) the same
// way company-level isActive already is, but for this one person's
// access to this one company only.
//
// Deactivating someone who's currently an active assignee (an agent,
// or an admin also assigned tickets via alsoAgent — checked by an
// Agents row existing for them, not by their Membership role literally
// being 'agent') with open tickets still on their desk refuses to
// silently leave those tickets stuck on someone who can no longer log
// in. The caller must pass reassignTo (another active agent's name) in
// the same request; without it, this returns the list of affected
// tickets so the frontend can prompt for a replacement before retrying.
router.put('/:id/active', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { companyId } = req.user
    const { isActive, reassignTo } = req.body

    const membershipResult = await pool.query(
      `SELECT m.id, m.role, p.name, p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.id = $1 AND m.companyId = $2`,
      [id, companyId]
    )
    const membership = membershipResult.rows[0]
    if (!membership) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!isActive) {
      const agentResult = await pool.query('SELECT * FROM Agents WHERE email = $1 AND companyId = $2', [membership.email, companyId])
      const agent = agentResult.rows[0]

      if (agent) {
        const openTicketsResult = await pool.query(
          `SELECT id, ticketId, title FROM Tickets WHERE assignedTo = $1 AND companyId = $2 AND status != 'Resolved'`,
          [agent.name, companyId]
        )
        const openTickets = openTicketsResult.rows

        if (openTickets.length > 0) {
          if (!reassignTo) {
            return res.status(409).json({
              error: `${membership.name} has ${openTickets.length} open ticket${openTickets.length === 1 ? '' : 's'} — choose who to reassign ${openTickets.length === 1 ? 'it' : 'them'} to before deactivating`,
              requiresReassignment: true,
              tickets: openTickets.map(t => ({ id: t.id, ticketId: t.ticketid, title: t.title }))
            })
          }

          if (reassignTo === agent.name) {
            return res.status(400).json({ error: 'Cannot reassign a deactivated agent\'s tickets to themselves' })
          }

          const targetAgent = await pool.query(
            `SELECT a.* FROM Agents a
             JOIN People p ON p.email = a.email
             JOIN Memberships m ON m.personId = p.id AND m.companyId = a.companyId
             WHERE a.name = $1 AND a.companyId = $2 AND m.isActive = true`,
            [reassignTo, companyId]
          )
          if (targetAgent.rows.length === 0) {
            return res.status(400).json({ error: 'The chosen replacement agent was not found or is not active in this company' })
          }

          await pool.query(
            `UPDATE Tickets SET assignedTo = $1 WHERE assignedTo = $2 AND companyId = $3 AND status != 'Resolved'`,
            [reassignTo, agent.name, companyId]
          )

          const replyFromAddress = await getTicketReplyFromAddress(pool, { companyId, clientOrgId: null })
          sendEmail(
            targetAgent.rows[0].email,
            `${openTickets.length} Ticket${openTickets.length === 1 ? '' : 's'} Reassigned to You`,
            `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #0A2540;">Tickets Reassigned to You</h1>
                <p>${membership.name} was deactivated, and the following ticket${openTickets.length === 1 ? ' was' : 's were'} reassigned to you:</p>
                <ul>
                  ${openTickets.map(t => `<li>${t.ticketid} — ${t.title}</li>`).join('')}
                </ul>
                <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
                <br/><br/>
                <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
              </div>
            `,
            null,
            replyFromAddress
          )
        }
      }
    }

    await pool.query('UPDATE Memberships SET isActive = $1 WHERE id = $2 AND companyId = $3', [isActive, id, companyId])

    res.json({ message: `${membership.name} ${isActive ? 'reactivated' : 'deactivated'} successfully!!` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
