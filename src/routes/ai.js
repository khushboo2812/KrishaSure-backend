const express = require('express')
const router = express.Router()
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { authenticateToken } = require('../middleware/auth')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// gemini-2.0-flash was retired by Google (confirmed live: the API
// returned 404 "This model models/gemini-2.0-flash is no longer
// available. Please update your code to use models/gemini-3.6-flash").
// Swapped to the model name Google's own error told us to use.
router.post('/suggest', authenticateToken, async (req, res) => {
  try {
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

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    res.json({ suggestion: text })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router