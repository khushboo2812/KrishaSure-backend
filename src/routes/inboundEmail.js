const express = require('express')
const router = express.Router()
const { Resend } = require('resend')
const { pool } = require('../config/db')
const { sendEmail } = require('../config/email')
const { supabase } = require('../config/storage')
const { INACTIVE_COMPANY_MESSAGE } = require('../middleware/auth')

const resend = new Resend(process.env.RESEND_API_KEY)

function generateTicketBodyFromEmail(text, html) {
  if (text) return text.trim()
  if (html) return html.replace(/<[^>]+>/g, ' ').trim()
  return ''
}

// Inline images (content_disposition 'inline') are already embedded in
// email.html as base64 data: URIs by default (Resend's default
// html_format), so only real attachments need saving as separate
// TicketAttachments. Best-effort: a failed download/upload for one
// attachment (or all of them) never blocks ticket creation, which has
// already happened by the time this runs — same "don't lose the whole
// thing over one bad file" policy attachments.js's own upload route
// uses for app-side uploads.
async function saveInboundAttachments(resend, emailId, attachments, ticketDbId, senderEmail) {
  const realAttachments = attachments.filter(a => a.content_disposition === 'attachment')

  for (const attachment of realAttachments) {
    try {
      const { data: attachmentData, error } = await resend.emails.receiving.attachments.get({
        emailId,
        id: attachment.id
      })
      if (error || !attachmentData?.download_url) {
        console.error('Failed to get inbound attachment download URL:', attachment.filename, error?.message)
        continue
      }

      const fileResponse = await fetch(attachmentData.download_url)
      if (!fileResponse.ok) {
        console.error('Failed to download inbound attachment:', attachment.filename, fileResponse.status)
        continue
      }
      const buffer = Buffer.from(await fileResponse.arrayBuffer())

      const fileName = attachment.filename || `attachment-${attachment.id}`
      const storagePath = `${ticketDbId}/${Date.now()}-${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('ticket-attachments')
        .upload(storagePath, buffer, { contentType: attachment.content_type })

      if (uploadError) {
        console.error('Storage upload failed for inbound attachment:', fileName, uploadError.message)
        continue
      }

      await pool.query(
        'INSERT INTO TicketAttachments (ticketId, fileName, storagePath, fileSize, uploadedBy, source) VALUES ($1, $2, $3, $4, $5, $6)',
        [ticketDbId, fileName, storagePath, attachment.size, senderEmail, 'email']
      )
    } catch (err) {
      console.error('Inbound attachment processing error:', attachment.filename, err.message)
    }
  }
}

function autoAssignAgent(agents, ticketList, category, priority) {
  const isCritical = priority === 'Urgent' || priority === 'High'
  let matched = agents.filter(a => a.skills && a.skills.split(',').includes(category))
  if (matched.length === 0) matched = [...agents]
  if (matched.length === 0) return null

  if (isCritical) {
    const seniors = matched.filter(a => a.level === 'Senior')
    if (seniors.length > 0) matched = seniors
  } else {
    const juniors = matched.filter(a => a.level === 'Junior')
    if (juniors.length > 0) matched = juniors
  }

  const agentLoad = matched.map(agent => ({
    agent,
    count: ticketList.filter(t => t.assignedto === agent.name && t.status !== 'Resolved').length
  }))
  agentLoad.sort((a, b) => a.count - b.count)
  return agentLoad[0].agent.name
}

router.post('/', async (req, res) => {
  // Hoisted so the catch block below can still bounce the sender even
  // if the crash happens after this is set but before a ticket exists —
  // previously an unexpected error meant the sender got no feedback at
  // all, same as every other unhandled-failure gap this app avoids
  // everywhere else in this file.
  let senderEmail = null
  try {
    const payload = req.body
    if (payload.type !== 'email.received') {
      return res.status(200).json({ ignored: true })
    }

    const { email_id, from, to, subject } = payload.data
    senderEmail = from.includes('<') ? from.match(/<(.+)>/)[1] : from

    const { data: email, error } = await resend.emails.receiving.get(email_id)
    if (error) {
      console.error('Failed to fetch inbound email content:', error.message)
      return res.status(200).json({ error: 'fetch_failed' })
    }

    const body = generateTicketBodyFromEmail(email.text, email.html)

    const personResult = await pool.query('SELECT * FROM People WHERE LOWER(email) = LOWER($1)', [senderEmail])

    if (personResult.rows.length === 0) {
      sendEmail(
        senderEmail,
        'Unable to create ticket',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #DC2626;">We couldn't create a ticket</h1>
            <p>This email address isn't registered with KrishaSure. Please contact your account administrator to be set up, or log in directly to raise a ticket.</p>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
      return res.status(200).json({ handled: 'unknown_sender' })
    }

    const person = personResult.rows[0]

    // Each client org can have its own dedicated address on our shared
    // support-email domain (e.g. acme-support@tickets.krishasure.io —
    // see ClientOrganizations.supportEmail, auto-generated in
    // clientOrgs.js).
    // When the mail was sent to one of those, it names the org directly,
    // so we don't need to fall back to guessing from the sender's own
    // memberships. Still require the sender to actually be a client
    // contact of that specific org before trusting it, so knowing/
    // guessing an address isn't enough on its own to raise a ticket
    // against it.
    const recipientEmails = Array.isArray(to)
      ? to.map(t => (typeof t === 'string' ? t : t?.email)).filter(Boolean)
      : (typeof to === 'string' ? [to] : [])

    let companyId = null
    let clientOrgId = null

    if (recipientEmails.length > 0) {
      const orgResult = await pool.query(
        'SELECT * FROM ClientOrganizations WHERE supportEmail = ANY($1::text[])',
        [recipientEmails]
      )
      const targetOrg = orgResult.rows[0]

      if (targetOrg) {
        const membershipResult = await pool.query(
          `SELECT 1 FROM Memberships WHERE personId = $1 AND role = 'client' AND companyId = $2 AND clientOrgId = $3`,
          [person.id, targetOrg.companyid, targetOrg.id]
        )
        if (membershipResult.rows.length > 0) {
          companyId = targetOrg.companyid
          clientOrgId = targetOrg.id
        }
      }
    }

    // Second priority: a company's own address (an internal company's
    // only address, or an MSP's general one, separate from each of its
    // client orgs' own addresses — see Companies.supportEmail, generated
    // in companies.js). Only tried when no client-org address matched
    // above. Require the sender to hold a client membership somewhere in
    // that company; if they have one tied to a specific client org,
    // prefer that org's id on the ticket over leaving it blank.
    if (!companyId && recipientEmails.length > 0) {
      const companyMatch = await pool.query(
        'SELECT * FROM Companies WHERE supportEmail = ANY($1::text[])',
        [recipientEmails]
      )
      const targetCompany = companyMatch.rows[0]

      if (targetCompany) {
        const membershipResult = await pool.query(
          `SELECT clientOrgId FROM Memberships WHERE personId = $1 AND role = 'client' AND companyId = $2 ORDER BY id LIMIT 1`,
          [person.id, targetCompany.id]
        )
        if (membershipResult.rows.length > 0) {
          companyId = targetCompany.id
          clientOrgId = membershipResult.rows[0].clientorgid || null
        }
      }
    }

    // Raising a ticket by email is a client-role action, so what
    // matters here is how many *client* memberships this person has —
    // not their total membership count. A person can freely hold one
    // client membership in Company A and, say, an admin membership in
    // Company B (exactly the multi-company-identity scenario this
    // schema exists for) and still email a ticket in unambiguously: the
    // one client membership is the answer. Only two or more client
    // memberships are genuinely ambiguous — the email address alone
    // can't say which company this ticket is for, so this is flagged
    // for manual triage rather than guessed.
    if (!companyId) {
      const membershipsResult = await pool.query(
        `SELECT m.companyId, m.clientOrgId FROM Memberships m WHERE m.personId = $1 AND m.role = 'client'`,
        [person.id]
      )
      const clientMemberships = membershipsResult.rows

      if (clientMemberships.length === 0) {
        sendEmail(
          senderEmail,
          'Unable to create ticket',
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #DC2626;">We couldn't create a ticket</h1>
              <p>This email address isn't set up as a client contact with KrishaSure. Please contact your account administrator, or log in directly to raise a ticket.</p>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `
        )
        return res.status(200).json({ handled: 'no_client_membership' })
      }

      if (clientMemberships.length > 1) {
        sendEmail(
          senderEmail,
          'Unable to create ticket automatically',
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #DC2626;">We couldn't create a ticket automatically</h1>
              <p>Your email address is registered as a client contact with more than one company on KrishaSure, so we can't tell which one this ticket is for.</p>
              <p>Please log in and raise the ticket directly so you can pick the right company, or email the company's own dedicated support address if you know it.</p>
              <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
              <br/><br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `
        )
        return res.status(200).json({ handled: 'ambiguous_sender' })
      }

      companyId = clientMemberships[0].companyid
      clientOrgId = clientMemberships[0].clientorgid || null
    }

    // A disabled company shouldn't accumulate tickets nobody there can
    // log in to see — same underlying "no activity while disabled"
    // principle as the login/mid-session gates, just via email instead
    // of the app.
    const companyResult = await pool.query('SELECT isActive FROM Companies WHERE id = $1', [companyId])
    if (!companyResult.rows[0] || !companyResult.rows[0].isactive) {
      sendEmail(
        senderEmail,
        'Unable to create ticket',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #DC2626;">We couldn't create a ticket</h1>
            <p>${INACTIVE_COMPANY_MESSAGE}.</p>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
      return res.status(200).json({ handled: 'company_inactive' })
    }

    const categoriesResult = await pool.query("SELECT * FROM Categories WHERE companyId = $1 AND name = 'General' LIMIT 1", [companyId])
let defaultCategory = categoriesResult.rows[0]?.name

if (!defaultCategory) {
  const fallbackResult = await pool.query('SELECT * FROM Categories WHERE companyId = $1 ORDER BY id LIMIT 1', [companyId])
  defaultCategory = fallbackResult.rows[0]?.name || 'General'
}
    const defaultPriority = 'Medium'

    const agentsResult = await pool.query('SELECT * FROM Agents WHERE companyId = $1', [companyId])
    const ticketsResult = await pool.query('SELECT * FROM Tickets WHERE companyId = $1', [companyId])
    const assignedTo = autoAssignAgent(agentsResult.rows, ticketsResult.rows, defaultCategory, defaultPriority)

    const countResult = await pool.query(
      "SELECT ticketId FROM Tickets WHERE companyId = $1 ORDER BY id DESC LIMIT 1",
      [companyId]
    )
    let nextNum = 1
    if (countResult.rows.length > 0) {
      const lastId = countResult.rows[0].ticketid
      const lastNum = parseInt(lastId.split('-')[1])
      nextNum = lastNum + 1
    }
    const ticketId = `KS-${String(nextNum).padStart(3, '0')}`
    const initialStatus = assignedTo ? 'Open/Assigned' : 'Open/Unassigned'

    const ticketInsertResult = await pool.query(
      'INSERT INTO Tickets (ticketId, title, description, category, priority, assignedTo, clientEmail, companyId, clientOrgId, status, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
      [ticketId, subject || 'No subject', body, defaultCategory, defaultPriority, assignedTo, senderEmail, companyId, clientOrgId, initialStatus, 'email']
    )
    const ticketDbId = ticketInsertResult.rows[0].id

    if (email.attachments && email.attachments.length > 0) {
      await saveInboundAttachments(resend, email_id, email.attachments, ticketDbId, senderEmail)
    }

    const admins = await pool.query(
      `SELECT p.email FROM Memberships m JOIN People p ON m.personId = p.id WHERE m.role IN ('superadmin', 'admin', 'platform_owner') AND m.companyId = $1`,
      [companyId]
    )
    const adminEmails = admins.rows.map(a => a.email).join(',')

    if (assignedTo) {
      const agentEmailResult = await pool.query(
  'SELECT email FROM Agents WHERE name = $1 AND companyId = $2',
  [assignedTo, companyId]
)
      const agentEmailAddress = agentEmailResult.rows[0]?.email

      if (agentEmailAddress) {
        sendEmail(
          agentEmailAddress,
          `New Ticket Assigned (via Email) - ${ticketId}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #0A2540;">New Ticket - Auto-Created from Email</h1>
              <p>This ticket was created automatically from an incoming email to support@krishasure.io, and auto-assigned to you.</p>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Ticket ID</strong></td><td style="padding: 8px;">${ticketId}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>From</strong></td><td style="padding: 8px;">${senderEmail}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Subject</strong></td><td style="padding: 8px;">${subject}</td></tr>
                <tr><td style="padding: 8px; background: #f4f7fb;"><strong>Category / Priority</strong></td><td style="padding: 8px;">${defaultCategory} / ${defaultPriority} (default, not confirmed by client)</td></tr>
              </table>
              <p>Log in to KrishaSure to review the full message, adjust the category or priority, or reassign it to a different agent if it's not the right fit for you.</p>
              <a href="https://app.krishasure.io" style="background: #00C2CB; color: #0A2540; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Open KrishaSure</a>
              <br/><br/>
              <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
            </div>
          `,
          adminEmails
        )
      }
    }

    sendEmail(
      senderEmail,
      `Ticket ${ticketId} Created - ${subject}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0A2540;">Ticket Created Successfully!!</h1>
          <p>We've created ticket <strong>${ticketId}</strong> from your email.</p>
          <p>Category: ${defaultCategory} · Priority: ${defaultPriority}</p>
          <p>You can log in to KrishaSure to track progress, add details, or adjust the category and priority.</p>
          <br/>
          <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
        </div>
      `,
      adminEmails
    )

    res.status(200).json({ ticketId })
  } catch (err) {
    console.error('Inbound email error:', err.message)
    if (senderEmail) {
      sendEmail(
        senderEmail,
        'Unable to create ticket',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #DC2626;">We couldn't create a ticket</h1>
            <p>Something went wrong on our end while processing your email. Please try again, or log in directly to raise a ticket.</p>
            <p style="color: #64748B; font-size: 12px;">Powered by Krisha Solutions</p>
          </div>
        `
      )
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router