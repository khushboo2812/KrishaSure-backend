const express = require('express')
const router = express.Router()
const multer = require('multer')
const { pool } = require('../config/db')
const { supabase } = require('../config/storage')
const { authenticateToken } = require('../middleware/auth')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }) // 10MB cap

// POST upload an attachment to a ticket
router.post('/:ticketId', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { ticketId } = req.params
    const { name } = req.user
    const file = req.file

    if (!file) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const storagePath = `${ticketId}/${Date.now()}-${file.originalname}`

    const { error: uploadError } = await supabase.storage
      .from('ticket-attachments')
      .upload(storagePath, file.buffer, { contentType: file.mimetype })

    if (uploadError) {
      console.error('Storage upload failed:', uploadError.message)
      return res.status(500).json({ error: 'Upload failed' })
    }

    await pool.query(
      'INSERT INTO TicketAttachments (ticketId, fileName, storagePath, fileSize, uploadedBy, source) VALUES ($1, $2, $3, $4, $5, $6)',
      [ticketId, file.originalname, storagePath, file.size, name, 'app']
    )

    res.status(201).json({ message: 'File uploaded successfully!!' })
  } catch (err) {
    console.error('Attachment upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET list attachments for a ticket
router.get('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params
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

    if (!attachment) {
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

module.exports = router