// backend connection test
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
// AI suggestions can carry image/PDF attachments as base64 in the JSON
// body — comfortably over the default 100kb express.json() limit below.
// Scoped to just this router (registered first, so it wins for /api/ai
// requests; body-parser skips re-parsing a body it's already parsed)
// rather than raising the limit for every route in the app.
app.use('/api/ai', express.json({ limit: '12mb' }))
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

const passwordResetRoutes = require('./routes/passwordReset')
app.use('/api/password-reset', passwordResetRoutes)
const clientOrgRoutes = require('./routes/clientOrgs')
app.use('/api/client-orgs', clientOrgRoutes)
const commentRoutes = require('./routes/comments')
app.use('/api/comments', commentRoutes)
const inboundEmailRoutes = require('./routes/inboundEmail')
app.use('/api/inbound-email', inboundEmailRoutes)
const attachmentRoutes = require('./routes/attachments')
app.use('/api/attachments', attachmentRoutes)
const reportRoutes = require('./routes/reports')
app.use('/api/reports', reportRoutes)
const platformReportRoutes = require('./routes/platformReports')
app.use('/api/platform/reports', platformReportRoutes)
const businessHoursRoutes = require('./routes/businessHours')
app.use('/api/business-hours', businessHoursRoutes)

// Checks every company sitting over its user limit and locks out the
// extras once their 30-working-day grace period has expired (see
// utils/overLimitTracking.js). No job scheduler in this app — a plain
// interval on the running server is enough, since it's a persistent
// process, not serverless. Runs shortly after boot too, so a company
// whose grace period expired while the server was down/redeploying
// doesn't have to wait up to 24h for the next tick.
const { enforceExpiredGracePeriods } = require('./utils/overLimitTracking')
const GRACE_PERIOD_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
setTimeout(() => enforceExpiredGracePeriods().catch(err => console.error('Grace-period check failed:', err.message)), 60 * 1000)
setInterval(() => enforceExpiredGracePeriods().catch(err => console.error('Grace-period check failed:', err.message)), GRACE_PERIOD_CHECK_INTERVAL_MS)

// Pending (waiting-on-client) tickets: reminder after 3 working days,
// auto-close after 5. Hourly so a reminder isn't up to a day late.
const { runPendingFollowUps } = require('./utils/pendingTickets')
const PENDING_FOLLOW_UP_INTERVAL_MS = 60 * 60 * 1000
setTimeout(() => runPendingFollowUps().catch(err => console.error('Pending follow-up failed:', err.message)), 90 * 1000)
setInterval(() => runPendingFollowUps().catch(err => console.error('Pending follow-up failed:', err.message)), PENDING_FOLLOW_UP_INTERVAL_MS)