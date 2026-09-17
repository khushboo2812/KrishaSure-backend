-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Backs the password-reset rate limit in routes/passwordReset.js.
-- Without it, repeated POST /api/password-reset/request calls for the
-- same email each immediately overwrite the person's password with a
-- fresh temp one and email it — no cooldown — so a caller could spam
-- someone's inbox and keep invalidating whatever temp password they
-- were just sent, before they'd have a chance to use it.
ALTER TABLE People ADD COLUMN IF NOT EXISTS lastPasswordResetRequestAt TIMESTAMPTZ;
