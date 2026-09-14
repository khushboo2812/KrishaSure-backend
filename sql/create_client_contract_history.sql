-- This repo has no migration runner (schema is managed directly in
-- Supabase), so run this by hand in the Supabase SQL editor before
-- deploying the ClientContractHistory changes in src/routes/clientOrgs.js.
--
-- Assumes ClientOrganizations.id is bigint (Supabase's default identity
-- type; nothing in this codebase uses uuid ids). If ClientOrganizations.id
-- is actually uuid in your database, change clientOrgId below to uuid
-- before running this.

CREATE TABLE IF NOT EXISTS ClientContractHistory (
  id BIGSERIAL PRIMARY KEY,
  clientOrgId BIGINT NOT NULL REFERENCES ClientOrganizations(id) ON DELETE CASCADE,
  previousContractedHours NUMERIC,
  previousResetCadence TEXT,
  previousOvertimeHandling TEXT,
  changedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changedBy TEXT
);

CREATE INDEX IF NOT EXISTS idx_clientcontracthistory_clientorgid
  ON ClientContractHistory (clientOrgId);
