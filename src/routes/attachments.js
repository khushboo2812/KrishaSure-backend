const express = require('express')
const router = express.Router()
const multer = require('multer')
const { pool } = require('../config/db')
const { supabase } = require('../config/storage')
const { authenticateToken } = require('../middleware/auth')
const { canAccessTicket, canAccessAttachment } = require('../utils/ticketAccess')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }) // 10MB cap

// POST upload one or more attachments to a ticket. Files are uploaded
// to storage one at a time (not Promise.all) so one bad file doesn't
// race a failed request against ones still in flight, and so a partial
// failure is easy to report accurately — every file gets its own
// outcome, and files that succeeded before a later one failed are kept
// (not rolled back), since there's no reason to discard a good upload
// just because a different file in the same batch failed.
router.post('/:ticketId', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    const { ticketId } = req.params
    const { email } = req.user
    const files = req.files

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No file provided' })
    }

    if (!(await canAccessTicket(pool, ticketId, req.user))) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    const uploaded = []
    const failed = []

    for (const file of files) {
      try {
        const storagePath = `${ticketId}/${Date.now()}-${file.originalname}`

        const { error: uploadError } = await supabase.storage
          .from('ticket-attachments')
          .upload(storagePath, file.buffer, { contentType: file.mimetype })

        if (uploadError) {
          console.error('Storage upload failed:', file.originalname, uploadError.message)
          failed.push({ fileName: file.originalname, error: 'Upload failed' })
          continue
        }

        await pool.query(
          'INSERT INTO TicketAttachments (ticketId, fileName, storagePath, fileSize, uploadedBy, source) VALUES ($1, $2, $3, $4, $5, $6)',
          [ticketId, file.originalname, storagePath, file.size, email, 'app']
        )
        uploaded.push(file.originalname)
      } catch (err) {
        console.error('Attachment upload error:', file.originalname, err.message)
        failed.push({ fileName: file.originalname, error: err.message })
      }
    }

    if (uploaded.length === 0) {
      return res.status(500).json({ error: 'All uploads failed', failed })
    }

    res.status(201).json({
      message: failed.length > 0
        ? `${uploaded.length} file(s) uploaded, ${failed.length} failed`
        : `${uploaded.length} file(s) uploaded successfully!!`,
      uploaded,
      failed
    })
  } catch (err) {
    console.error('Attachment upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET list attachments for a ticket
router.get('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
    if (!(await canAccessTicket(pool, ticketId, req.user))) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    const result = await pool.query('SELECT * FROM TicketAttachments WHERE ticketId = $1 ORDER BY createdAt ASC', [ticketId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET download a specific attachment (returns a temporary signed URL)
router.get('/download/:attachmentId', authenticateToken, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const result = await pool.query('SELECT * FROM TicketAttachments WHERE id = $1', [attachmentId])
    const attachment = result.rows[0]

    if (!attachment || !(await canAccessAttachment(pool, attachmentId, req.user))) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    const { data, error } = await supabase.storage
      .from('ticket-attachments')
      .createSignedUrl(attachment.storagepath, 60) // valid for 60 seconds

    if (error) {
      return res.status(500).json({ error: 'Failed to generate download link' })
    }

    res.json({ url: data.signedUrl, fileName: attachment.filename })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:attachmentId', authenticateToken, async (req, res) => {
  try {
    const { attachmentId } = req.params
    const { email } = req.user

        const result = await pool.query('SELECT * FROM TicketAttachments WHERE id = $1', [attachmentId])
    const attachment = result.rows[0]

    if (!attachment || !(await canAccessAttachment(pool, attachmentId, req.user))) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    if (attachment.uploadedby !== email) {
      return res.status(403).json({ error: 'You can only delete attachments you uploaded' })
    }

    const { error: storageError } = await supabase.storage
      .from('ticket-attachments')
      .remove([attachment.storagepath])

    if (storageError) {
      console.error('Failed to delete from storage:', storageError.message)
    }

    await pool.query('DELETE FROM TicketAttachments WHERE id = $1', [attachmentId])

    res.json({ message: 'Attachment deleted successfully!!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router