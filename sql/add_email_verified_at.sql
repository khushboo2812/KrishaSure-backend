-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Users.emailVerified was a boolean with no timestamp of when
-- verification happened, so there was no way to trend verifications
-- over time (only the current true/false snapshot). This column is set
-- at the moment of verification in POST /api/users/verify/:token/confirm,
-- and read by GET /api/platform/reports/signups-trend.

ALTER TABLE Users
  ADD COLUMN IF NOT EXISTS emailVerifiedAt TIMESTAMPTZ;
