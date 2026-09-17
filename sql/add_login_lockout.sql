-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Backs the login brute-force lockout in routes/auth.js. Without this,
-- POST /api/auth/login had no limit on failed attempts at all — an
-- attacker could try passwords against a known email indefinitely.
ALTER TABLE People ADD COLUMN IF NOT EXISTS failedLoginAttempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE People ADD COLUMN IF NOT EXISTS lockedUntil TIMESTAMPTZ;
