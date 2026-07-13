const sql = require('mssql')
require('dotenv').config()

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: '127.0.0.1',
  database: process.env.DB_NAME,
  port: 58018,
  connectionTimeout: 30000,
  requestTimeout: 30000,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
}

const connectDB = async () => {
  try {
    await sql.connect(config)
    console.log('Connected to SQL Server!! ✅')
  } catch (err) {
    console.error('Database connection failed:', err.message)
  }
}

module.exports = { connectDB, sql }