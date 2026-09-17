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
// yet — it's entirely possible they don't know what's actually wrong,
// which is exactly why they're asking the AI. Treating their pick as a
// given fact could steer the diagnosis toward the wrong kind of
// problem, so it's deliberately left out of the prompt; the AI decides
// a likely category itself from the title/description instead of
// trusting one that might be wrong.
function buildInitialPrompt(title, description) {
  return `You are an IT support assistant for KrishaSure ticketing system.

A support ticket has been raised with the following details:
- Title: ${title}
- Description: ${description}

Please provide:
1. A brief diagnosis of the likely cause
2. 3 step-by-step troubleshooting steps the user can try
3. Whether this needs urgent attention
4. Which category this most likely belongs to (e.g. Hardware, Software, Network, Account/Access, General) — decide this yourself from the title and description; don't assume any category the person filing it may have already picked, since they may not know what's actually wrong yet

Keep your response concise and practical.`
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
  const { title, description } = req.body
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })

  try {
    const text = await generateWithRetry(async () => {
      const result = await model.generateContent(buildInitialPrompt(title, description))
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
// `message` is the new thing the person just typed. Kept as its own
// endpoint rather than folding into /suggest (branching on whether
// history is present) since the two have genuinely different request
// shapes — one seeds a conversation from a ticket's title/description,
// this one continues an already-open one.
router.post('/chat', authenticateToken, async (req, res) => {
  const { history, message } = req.body
  if (!Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'history and message are required' })
  }
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })

  try {
    const text = await generateWithRetry(async () => {
      const chat = model.startChat({ history })
      const result = await chat.sendMessage(message)
      const response = await result.response
      return response.text()
    })
    res.json({ reply: text })
  } catch (err) {
    respondWithAiError(res, err)
  }
})

module.exports = router