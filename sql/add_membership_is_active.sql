-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- isActive: soft-disable switch for a single membership — one person's
-- access to one specific company, unlike Companies.isActive which
-- disables everyone in a company at once. Scenario: someone leaves the
-- company. Gates login (routes/auth.js) and mid-session access
-- (middleware/auth.js) for that membership only; platform_owner is
-- exempt everywhere, same as the company-level gate. Defaults to true
-- so every existing membership stays exactly as usable as it is today.

ALTER TABLE Memberships
  ADD COLUMN IF NOT EXISTS isActive BOOLEAN NOT NULL DEFAULT true;
