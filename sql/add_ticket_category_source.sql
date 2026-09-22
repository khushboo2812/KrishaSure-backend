-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Where a ticket's current category/priority came from, so the UI can
-- flag the ones worth double-checking:
--   'ai'      — picked automatically from an inbound email's content
--   'manual'  — an agent or superadmin changed it by hand
--   NULL      — set by whoever filed it in the app, or an inbound email
--               the AI didn't classify (filed under General / Medium)
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS categorySource VARCHAR(20);
