-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- supportEmail: a dedicated inbound address on our shared krishasure.io
-- domain, auto-generated per Client Organization (e.g.
-- "acme-support@krishasure.io") when it's created. inboundEmail.js
-- matches the recipient address against this column to attribute a
-- ticket to the right client org directly, without relying solely on
-- the sender's own membership(s). Unique across the whole table (not
-- just per-company) since every address shares one verified domain.
-- Nullable so any client orgs that existed before this migration keep
-- working via the existing sender-identity lookup until backfilled.

ALTER TABLE ClientOrganizations
  ADD COLUMN IF NOT EXISTS supportEmail TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clientorganizations_supportemail_unique
  ON ClientOrganizations (supportEmail)
  WHERE supportEmail IS NOT NULL;
