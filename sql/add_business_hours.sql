-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Per-company business hours, used to compute SLA breach and "time
-- open" excluding nights and weekends, instead of raw wall-clock time.
-- Applies uniformly to every company (internal and MSP alike) — this
-- is a per-company setting, not per-client-org.
--
-- businessDays is a comma-separated list of 3-letter weekday
-- abbreviations (Mon,Tue,Wed,Thu,Fri by default). businessHoursStart/
-- End are local time-of-day strings ('09:00'/'17:00') interpreted in
-- `timezone` (an IANA zone name, e.g. 'America/New_York' — defaults
-- to UTC so nothing breaks for a company that never sets one).
ALTER TABLE Companies ADD COLUMN IF NOT EXISTS businessDays TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri';
ALTER TABLE Companies ADD COLUMN IF NOT EXISTS businessHoursStart TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE Companies ADD COLUMN IF NOT EXISTS businessHoursEnd TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE Companies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
