-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- supportEmail: a dedicated inbound address on our shared krishasure.io
-- domain, auto-generated per Company (e.g. "acme-support@krishasure.io")
-- when it's created — the same pattern already used for
-- ClientOrganizations.supportEmail, but at the company level so internal
-- companies (which have no client orgs) get one too, and MSP companies
-- get a general address separate from each of their client orgs'
-- individual addresses. inboundEmail.js matches on this as a
-- second-priority tier, after client-org addresses and before the
-- generic sender-identity fallback. Unique across the whole table (and
-- checked against ClientOrganizations.supportEmail too, in application
-- code) since every address shares one verified domain. Nullable so
-- companies that existed before this migration keep working via the
-- existing fallback lookup until backfilled.

ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS supportEmail TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS companies_supportemail_unique
  ON Companies (supportEmail)
  WHERE supportEmail IS NOT NULL;
