-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- "Pending" = waiting on the client. While a ticket is Pending its SLA
-- clock is paused:
--   pendingSince          — when the current Pending period started
--                           (NULL when not Pending)
--   pausedBusinessHours   — business hours spent Pending in earlier
--                           periods of the current round, subtracted
--                           from the SLA timer (reset on reopen)
--   pendingReminderSentAt — when the "we're still waiting" reminder
--                           went out, so it's sent once per period
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS pendingSince TIMESTAMPTZ;
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS pausedBusinessHours DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS pendingReminderSentAt TIMESTAMPTZ;

-- Email replies to an existing ticket become comments. Resend can
-- deliver the same email twice, so the email's id is stored and kept
-- unique to avoid a duplicate comment.
ALTER TABLE TicketComments ADD COLUMN IF NOT EXISTS sourceEmailId TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ticketcomments_sourceemailid_key ON TicketComments (sourceEmailId);

-- Emailed replies can be longer than the app's 500-character comment
-- box. Widening to TEXT is safe: existing rows are untouched.
ALTER TABLE TicketComments ALTER COLUMN comment TYPE TEXT;
