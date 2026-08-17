const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
})

const connectDB = async () => {
  try {
    await pool.query('SELECT NOW()')
    console.log('Connected to Supabase PostgreSQL!! ✅')
  } catch (err) {
    console.error('Database connection failed:', err.message)
  }
}

module.exports = { connectDB, pool }