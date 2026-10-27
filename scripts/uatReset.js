// Empties every table in the UAT database (all companies, users,
// tickets...), ready for a fresh `npm run uat:seed`. Needs --yes.
// Refuses to run unless APP_ENV is 'uat', and refuses if the database
// looks like production (PRODUCTION_DB_HOST).
const { IS_UAT } = require('../src/config/env')

function die(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

if (!IS_UAT) die('Refusing to run: APP_ENV must be "uat". This script deletes every row.')
if (!process.env.PRODUCTION_DB_HOST) die('Refusing to run: set PRODUCTION_DB_HOST (the host part of the production database URL) so I can be sure this is not production.')
if (String(process.env.SUPABASE_DB_URL || '').includes(process.env.PRODUCTION_DB_HOST)) die('Refusing to run: SUPABASE_DB_URL points at the production database.')
if (!process.argv.includes('--yes')) die('This deletes ALL data in the UAT database. Run again with --yes to confirm.')

const { pool } = require('../src/config/db')

async function main() {
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
  if (tables.rows.length === 0) die('No tables found. Has the UAT schema been created yet?')
  const list = tables.rows.map(t => `public."${t.tablename}"`).join(', ')
  await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
  console.log(`Emptied ${tables.rows.length} tables.`)
  await pool.end()
}

main().catch(err => { console.error('Reset failed:', err.message); process.exit(1) })
