-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- isActive: soft-disable switch for a company. The company and all its
-- data stay completely intact either way — this only gates whether its
-- users (any role except platform_owner, who is always exempt) can log
-- in or keep using an already-open session, and whether inbound email
-- can create tickets for it. Toggled from the Platform Dashboard's
-- company list. Defaults to true so every existing company stays
-- exactly as usable as it is today.

ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS isActive BOOLEAN NOT NULL DEFAULT true;
