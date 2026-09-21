-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Tier-limit fields for the AI pricing tiers. All nullable/permissive
-- by default, so every existing company stays completely unlimited
-- until someone explicitly sets a limit on it — and even then, none of
-- it is actually checked unless PlatformSettings.enforceUsageLimits is
-- true (see below). This is deliberately built ahead of turning
-- enforcement on, so it's ready the moment it's needed instead of
-- being built under pressure later.
ALTER TABLE Companies
  ADD COLUMN IF NOT EXISTS maxUsers INTEGER,
  ADD COLUMN IF NOT EXISTS maxAiRequestsPerMonth INTEGER,
  ADD COLUMN IF NOT EXISTS aiEnabled BOOLEAN NOT NULL DEFAULT true;

-- One global on/off switch for all usage-limit enforcement across the
-- whole app — a single row, never more than one (enforced by the id=1
-- check constraint). Defaults to false, so building and deploying this
-- changes nothing for existing companies today.
CREATE TABLE IF NOT EXISTS PlatformSettings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enforceUsageLimits BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT platformsettings_single_row CHECK (id = 1)
);
INSERT INTO PlatformSettings (id, enforceUsageLimits) VALUES (1, false)
  ON CONFLICT (id) DO NOTHING;

-- To actually start enforcing tiers later:
--   UPDATE PlatformSettings SET enforceUsageLimits = true WHERE id = 1;
-- To turn it back off:
--   UPDATE PlatformSettings SET enforceUsageLimits = false WHERE id = 1;

-- Every /api/ai/suggest and /api/ai/chat call that actually reaches
-- Gemini logs a row here — unconditionally, regardless of the toggle
-- above. This is what a company's monthly AI request count gets
-- checked against once enforcement is on, and in the meantime it's
-- real per-company usage data for deciding what limits/pricing make
-- sense, same spirit as the [ai-usage] token logging already added.
CREATE TABLE IF NOT EXISTS AiUsageLog (
  id BIGSERIAL PRIMARY KEY,
  companyId BIGINT NOT NULL REFERENCES Companies(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aiusagelog_companyid_createdat
  ON AiUsageLog (companyId, createdAt);
