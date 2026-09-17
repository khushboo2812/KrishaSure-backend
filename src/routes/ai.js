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

// gemini-2.0-flash was retired by Google (confirmed live: the API
// returned 404 "This model models/gemini-2.0-flash is no longer
// available. Please update your code to use models/gemini-3.6-flash").
// Swapped to the model name Google's own error told us to use.
router.post('/suggest', authenticateToken, async (req, res) => {
  const { title, description, category } = req.body

  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })

  const prompt = `You are an IT support assistant for KrishaSure ticketing system.

A support ticket has been raised with the following details:
- Title: ${title}
- Category: ${category}
- Description: ${description}

Please provide:
1. A brief diagnosis of the likely cause
2. 3 step-by-step troubleshooting steps the user can try
3. Whether this needs urgent attention

Keep your response concise and practical.`

  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()
      return res.json({ suggestion: text })
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isRetryableOverload(err)) {
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      break
    }
  }

  if (isRetryableOverload(lastErr)) {
    return res.status(503).json({ error: "The AI service is temporarily overloaded — please try again in a moment." })
  }
  res.status(500).json({ error: lastErr.message })
})

module.exports = router