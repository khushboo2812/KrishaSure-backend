const express = require('express')
const router = express.Router()
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { authenticateToken } = require('../middleware/auth')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 800

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Google returns 503 "currently experiencing high demand" for gemini-3.6-flash
// fairly often — it's a transient overload on their end, not something
// wrong with the request, and a client hitting it once mid-demo
// shouldn't have to manually retry. Checks both the SDK's own status
// field (when present) and the message text, since which one is
// populated has varied across SDK versions/error shapes we've seen.
function isRetryableOverload(err) {
  const status = err?.status || err?.httpStatus
  if (status === 503) return true
  return /503|overloaded|high demand/i.test(err?.message || '')
}

// Google's free tier caps gemini-3.6-flash at a small number of
// requests per DAY (confirmed live: "429 Too Many Requests ...
// GenerateRequestsPerDayPerProjectPerModel-FreeTier ... limit: 20").
// Distinct from isRetryableOverload above: that's a transient blip
// worth an immediate retry, this is a hard daily cap that won't clear
// for hours, so retrying in a few seconds would just burn another
// attempt for nothing. Needs its own clear message for the same reason
// the 503 case does — the raw error is an unreadable wall of JSON.
function isQuotaExceeded(err) {
  const status = err?.status || err?.httpStatus
  if (status === 429) return true
  return /429|quota exceeded|resource_exhausted/i.test(err?.message || '')
}

// Attachments (a screenshot of an error, a photo of a device) ride
// along as base64 in the JSON body — see index.js for the raised body-
// size limit this needs. Deliberately strict, not best-effort: silently
// dropping an unsupported/oversized file used to leave the person
// thinking the AI had looked at something it never saw. Any attachment
// that doesn't qualify now fails the whole request with a clear reason
// instead — the frontend already filters before sending, so reaching
// this validation at all means something slipped past that check.
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
])

// The frontend sends FileReader's readAsDataURL() result as-is
// ("data:image/png;base64,iVBORw0KG...") — Gemini's inlineData part
// wants just the base64 payload, so this strips the data: URI prefix
// when present rather than requiring the caller to.
function normalizeBase64(data) {
  const commaIndex = data.indexOf(',')
  return typeof data === 'string' && data.startsWith('data:') && commaIndex !== -1
    ? data.slice(commaIndex + 1)
    : data
}

// Returns { parts } on success or { error } on the first attachment
// that fails validation — never both, and never a partial result, so
// the caller can't accidentally run a diagnosis "missing" an attachment
// the person thought they'd included.
function validateAttachments(attachments) {
  if (attachments === undefined || attachments === null) return { parts: [] }
  if (!Array.isArray(attachments)) return { error: 'attachments must be an array' }
  if (attachments.length > MAX_ATTACHMENTS) {
    return { error: `Only up to ${MAX_ATTACHMENTS} attachments are supported at once — remove some and try again.` }
  }

  const parts = []
  for (const a of attachments) {
    if (!a || typeof a.data !== 'string' || !ALLOWED_ATTACHMENT_MIME_TYPES.has(a.mimeType)) {
      return { error: `${a?.fileName ? `"${a.fileName}" isn't` : 'One of the attachments is not'} a supported file type — the AI can only look at images (PNG, JPEG, WEBP, HEIC, HEIF) or PDFs.` }
    }
    const data = normalizeBase64(a.data)
    if (Buffer.byteLength(data, 'base64') > MAX_ATTACHMENT_BYTES) {
      return { error: `${a.fileName ? `"${a.fileName}" is` : 'One of the attachments is'} too large for the AI to look at (max 4MB) — remove it and try again.` }
    }
    parts.push({ inlineData: { mimeType: a.mimeType, data } })
  }
  return { parts }
}

function respondWithAiError(res, err) {
  if (isRetryableOverload(err)) {
    return res.status(503).json({ error: "The AI service is temporarily overloaded — please try again in a moment." })
  }
  if (isQuotaExceeded(err)) {
    return res.status(429).json({ error: "You've hit today's free AI usage limit. It resets at midnight Pacific time, or enable billing on the Google Cloud project behind your API key to remove the cap." })
  }
  res.status(500).json({ error: err.message })
}

// Whoever's filing the ticket may not have picked the right category
// (or priority) yet — it's entirely possible they don't know what's
// actually wrong, which is exactly why they're asking the AI. Category
// and urgency/priority are the ticket form's own job (and the human
// triaging it, afterward); this endpoint sticks to diagnosis and
// troubleshooting steps only — not the user's pick for either field,
// not its own guess — so there's nothing here that could steer toward
// the wrong kind of problem or duplicate something the ticket itself
// already owns.
function buildInitialPrompt(title, description) {
  return `You are an IT support assistant for KrishaSure ticketing system.

A support ticket has been raised with the following details:
- Title: ${title}
- Description: ${description}

Please provide:
1. A brief diagnosis of the likely cause
2. 3 step-by-step troubleshooting steps the user can try

If an image or file is attached, factor in whatever it actually shows (a screenshot of an error, a photo of a device, etc.) alongside the title and description above.

Keep your response concise and practical. Do not mention or guess at a ticket category, and do not assess urgency/priority — both are decided separately, on the ticket itself.`
}

async function generateWithRetry(fn) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isRetryableOverload(err)) {
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      break
    }
  }
  throw lastErr
}

// gemini-2.0-flash was retired by Google (confirmed live: the API
// returned 404 "This model models/gemini-2.0-flash is no longer
// available. Please update your code to use models/gemini-3.6-flash").
// Swapped to the model name Google's own error told us to use.
router.post('/suggest', authenticateToken, async (req, res) => {
  const { title, description, attachments } = req.body
  const { parts: attachmentParts, error: attachmentError } = validateAttachments(attachments)
  if (attachmentError) {
    return res.status(400).json({ error: attachmentError })
  }
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })
  const parts = [{ text: buildInitialPrompt(title, description) }, ...attachmentParts]

  try {
    const text = await generateWithRetry(async () => {
      const result = await model.generateContent(parts)
      const response = await result.response
      return response.text()
    })
    res.json({ suggestion: text })
  } catch (err) {
    respondWithAiError(res, err)
  }
})

// POST continue an existing AI-suggestion conversation with a follow-up
// question, so the person filing a ticket can go back and forth with
// the AI rather than getting one static reply. `history` is every
// prior turn of the conversation (the initial ticket prompt, the
// initial suggestion, and any further exchange since) in the Gemini
// SDK's own chat format ([{role: 'user'|'model', parts: [{text}]}]);
// `message` is the new thing the person just typed, and `attachments`
// (optional) is anything newly attached since the last message the AI
// actually saw. Kept as its own endpoint rather than folding into
// /suggest (branching on whether history is present) since the two
// have genuinely different request shapes — one seeds a conversation
// from a ticket's title/description, this one continues an already-
// open one.
router.post('/chat', authenticateToken, async (req, res) => {
  const { history, message, attachments } = req.body
  if (!Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'history and message are required' })
  }
  // A new attachment added mid-conversation (a 3rd screenshot after
  // the first two) belongs to *this* message, same as the initial
  // ones belong to the opening one — not resent on every later turn,
  // just attached to the message that actually introduces it. Same
  // validation as /suggest, so an unsupported/oversized one here fails
  // just as clearly instead of the model silently never seeing it.
  const { parts: attachmentParts, error: attachmentError } = validateAttachments(attachments)
  if (attachmentError) {
    return res.status(400).json({ error: attachmentError })
  }
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })

  try {
    const text = await generateWithRetry(async () => {
      const chat = model.startChat({ history })
      const result = await chat.sendMessage([{ text: message }, ...attachmentParts])
      const response = await result.response
      return response.text()
    })
    res.json({ reply: text })
  } catch (err) {
    respondWithAiError(res, err)
  }
})

module.exports = router