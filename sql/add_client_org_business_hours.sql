-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Optional per-client-org override of the company's own business
-- hours (sql/add_business_hours.sql), for the case an MSP's client is
-- in a different timezone or negotiated different support hours. All
-- four columns are NULLable and default to NULL — meaning "no
-- override, use the company's hours" — unlike Companies' own columns,
-- which default to a real value. Set together (all four or none) by
-- the settings endpoint in routes/clientOrgs.js.
ALTER TABLE ClientOrganizations ADD COLUMN IF NOT EXISTS businessDays TEXT;
ALTER TABLE ClientOrganizations ADD COLUMN IF NOT EXISTS businessHoursStart TEXT;
ALTER TABLE ClientOrganizations ADD COLUMN IF NOT EXISTS businessHoursEnd TEXT;
ALTER TABLE ClientOrganizations ADD COLUMN IF NOT EXISTS timezone TEXT;
