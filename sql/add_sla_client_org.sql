-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Lets an SLA rule be scoped to one client org, the same way it can
-- already be scoped to one category (see add_ticket_category
-- override in resolveSlaRule, routes/reports.js and
-- ticketHelpers.js). An MSP company manages several client orgs, each
-- of which can have its own contracted SLA times — without this,
-- every client org under one MSP was forced to share identical SLA
-- rules. NULL (the default, and the only option for a non-MSP company)
-- means "applies to every client org," same as NULL categoryId means
-- "applies to every category."
ALTER TABLE SLARules
  ADD COLUMN IF NOT EXISTS clientOrgId BIGINT REFERENCES ClientOrganizations(id) ON DELETE CASCADE;
