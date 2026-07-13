const bcrypt = require('bcryptjs')
const { connectDB, sql } = require('./config/db')
require('dotenv').config()

async function hashExistingPasswords() {
  await connectDB()
  
  const result = await sql.query`SELECT id, password FROM Users`
  
  for (const user of result.recordset) {
    // Only hash if not already hashed
    if (!user.password.startsWith('$2b$')) {
      const hashed = await bcrypt.hash(user.password, 10)
      await sql.query`UPDATE Users SET password = ${hashed} WHERE id = ${user.id}`
      console.log(`Hashed password for user ${user.id}`)
    }
  }
  
  console.log('All passwords hashed!! ✅')
  process.exit()
}

hashExistingPasswords()