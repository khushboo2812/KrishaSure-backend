-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Lowering a company's maxUsers below its current active user count
-- doesn't kick anyone out on its own — checkUserLimit only blocks
-- ADDING new users past the cap, it never retroactively deactivates
-- existing ones (see usageLimits.js). This tracks how long a company
-- has been sitting over its own limit so it can be handled on a
-- grace-period timer instead of silently, forever: overLimitSince is
-- set the moment a company goes over (see checkAndTrackOverLimit,
-- src/utils/overLimitTracking.js) and cleared automatically once
-- they're back within it; overLimitLockedOut flips to true once the
-- 30-working-day grace period expires and everyone but one superadmin
-- has been deactivated to bring them back in line.
ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS overLimitSince TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overLimitLockedOut BOOLEAN NOT NULL DEFAULT false;
