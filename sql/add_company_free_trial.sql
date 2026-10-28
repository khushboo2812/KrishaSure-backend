-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Free trial: trialEndsAt is when a company's free trial ends. NULL
-- means it is not on a trial (a normal paying company), so every
-- existing company stays exactly as it is today. Once the date passes,
-- the company's users can no longer log in or keep using an open
-- session (the platform owner is always exempt) until the trial is
-- extended or the company is converted to paid, from the Platform
-- Dashboard.
--
-- trialReminderSentAt / trialEndedNotifiedAt remember that the "3 days
-- left" and "trial has ended" emails have gone out, so the daily check
-- sends each only once per trial. Both are cleared whenever the trial
-- is started or extended.
ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS trialEndsAt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trialReminderSentAt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trialEndedNotifiedAt TIMESTAMPTZ;
