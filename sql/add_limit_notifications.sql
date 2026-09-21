-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Tracks the last time a "this company hit its plan limit" email was
-- sent, per company and per reason (user_limit / ai_disabled /
-- ai_request_limit) — see notifyLimitCrossed in
-- src/utils/usageLimits.js. Without this, someone mashing "Get AI
-- Suggestion" while over their cap would trigger a fresh email on
-- every single click; this caps it to one per company per reason per
-- cooldown window instead.
CREATE TABLE IF NOT EXISTS LimitNotifications (
  companyId BIGINT NOT NULL REFERENCES Companies(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  lastSentAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (companyId, reason)
);
