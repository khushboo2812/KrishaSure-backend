-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Per-company Pending ticket rules, set by the company's own admin
-- under Settings -> Pending tickets. Both are counted in working days
-- (Mon-Fri) from when the ticket went Pending.
--   pendingReminderDays   remind the client after this many days;
--                         NULL = never send a reminder
--   pendingAutoCloseDays  close the ticket after this many days with no
--                         client reply; NULL = never close automatically
-- The defaults (3 and 5) are exactly what every company had before
-- these were configurable, so nothing changes until someone edits them.
ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS pendingReminderDays INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pendingAutoCloseDays INTEGER DEFAULT 5;
