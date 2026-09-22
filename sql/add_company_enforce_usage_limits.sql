-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Replaces the single global PlatformSettings.enforceUsageLimits
-- switch with a per-company one — the global switch meant turning
-- enforcement on for one pilot client turned it on for every company
-- at once, which isn't how a gradual rollout works. Defaults to
-- false, same as the global switch did, so every existing company
-- stays unlimited until explicitly turned on for it specifically.
--
-- PlatformSettings and the old GET/PUT /api/platform-settings route
-- are no longer used after this — safe to leave the table in place
-- (it's just inert now) or drop it later if you want:
--   DROP TABLE IF EXISTS PlatformSettings;
ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS enforceUsageLimits BOOLEAN NOT NULL DEFAULT false;
