const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { connectDB } = require('./config/db')
const { sendEmail } = require('./config/email')

const ticketRoutes = require('./routes/tickets')
const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/users')
const setupRoutes = require('./routes/setup')
const aiRoutes = require('./routes/ai')
const categoryRoutes = require('./routes/categories')
const slaRoutes = require('./routes/sla')
const agentRoutes = require('./routes/agents')

const app = express()

app.use(cors())
app.use(express.json())

connectDB()

app.get('/', (req, res) => {
  res.json({ message: 'KrishaSure API is running!! 🚀' })
})

app.get('/test-email', async (req, res) => {
  await sendEmail(
    'khushboo@krishasolutions.net',
    'KrishaSure Email Test!! 🎉',
    '<h1>KrishaSure email is working!!</h1><p>Your email setup is complete!!</p>'
  )
  res.json({ message: 'Email sent!!' })
})

app.use('/api/tickets', ticketRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/setup', setupRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/sla', slaRoutes)
app.use('/api/agents', agentRoutes)

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`KrishaSure backend running on port ${PORT}`)
})

const companyRoutes = require('./routes/companies')
app.use('/api/companies', companyRoutes)