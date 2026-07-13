const express = require('express')
const router = express.Router()
const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

router.post('/suggest', async (req, res) => {
  try {
    const { title, description, category } = req.body

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

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