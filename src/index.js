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