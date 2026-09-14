-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- contractEndDate: optional expiry for a client org's hours contract.
-- Once passed, the contract is treated as inactive everywhere (see
-- isContractActive in src/utils/contractPeriod.js) — hours become
-- optional again, same as an org with no contract. Existing HoursLog
-- and ClientContractHistory rows are untouched either way.
--
-- carriedOverHours: the outstanding overage (if any) carried into the
-- client org's current billing period when overtimeHandling is
-- "Roll over". Always 0 for "Settle separately" orgs. Maintained by
-- advancePeriodIfDue in src/utils/contractPeriod.js, which lazily rolls
-- currentPeriodStart forward — on read, not on a schedule — past any
-- resetCadence periods that have fully elapsed.

ALTER TABLE ClientOrganizations
  ADD COLUMN IF NOT EXISTS contractEndDate DATE,
  ADD COLUMN IF NOT EXISTS carriedOverHours NUMERIC NOT NULL DEFAULT 0;
