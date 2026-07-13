const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { connectDB } = require('./config/db')
const ticketRoutes = require('./routes/tickets')
const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/users')

const app = express()

app.use(cors())
app.use(express.json())

connectDB()

app.get('/', (req, res) => {
  res.json({ message: 'KrishaSure API is running!! 🚀' })
})

app.use('/api/tickets', ticketRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`KrishaSure backend running on port ${PORT}`)
})

const aiRoutes = require('./routes/ai')
app.use('/api/ai', aiRoutes)

const categoryRoutes = require('./routes/categories')
const slaRoutes = require('./routes/sla')

app.use('/api/categories', categoryRoutes)
app.use('/api/sla', slaRoutes)

const { sendEmail } = require('./config/email')

app.get('/test-email', async (req, res) => {
  await sendEmail(
    'khushboo@krishasolutions.net',
    'KrishaSure Email Test!! 🎉',
    '<h1>KrishaSure email is working!!</h1><p>Your email setup is complete!!</p>'
  )
  res.json({ message: 'Email sent!!' })
})

const agentRoutes = require('./routes/agents')
app.use('/api/agents', agentRoutes)