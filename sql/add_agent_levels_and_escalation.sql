-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Agent levels are now defined by each company instead of being the
-- fixed pair Junior/Senior, and a per-priority "Assignment & Escalation"
-- matrix decides where tickets start and how far they escalate when
-- their SLA is breached.
--
-- Agents.level stays a plain text column holding the level's name (a
-- level rename updates it), so existing rows and queries keep working.

CREATE TABLE IF NOT EXISTS AgentLevels (
  id SERIAL PRIMARY KEY,
  companyId INTEGER NOT NULL REFERENCES Companies(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  rank INTEGER NOT NULL,              -- 1 = lowest; escalation moves to a higher rank
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS agentlevels_company_name_key ON AgentLevels (companyId, LOWER(name));

CREATE TABLE IF NOT EXISTS PriorityRouting (
  companyId INTEGER NOT NULL REFERENCES Companies(id) ON DELETE CASCADE,
  priority VARCHAR(20) NOT NULL CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  startLevelId INTEGER REFERENCES AgentLevels(id),   -- where a new ticket of this priority goes
  escalate BOOLEAN NOT NULL DEFAULT true,            -- move up a level when the SLA is breached
  maxLevelId INTEGER REFERENCES AgentLevels(id),     -- highest level it may reach (NULL = the top)
  PRIMARY KEY (companyId, priority)
);

-- Master switch, off by default: nothing escalates until a company's
-- superadmin turns it on.
ALTER TABLE Companies ADD COLUMN IF NOT EXISTS escalationEnabled BOOLEAN NOT NULL DEFAULT false;

-- Per-ticket escalation state for the current round (reset on reopen).
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS escalatedCount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS escalatedAt TIMESTAMPTZ;
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS slaWarningSentAt TIMESTAMPTZ;
ALTER TABLE Tickets ADD COLUMN IF NOT EXISTS escalationAlertSentAt TIMESTAMPTZ;

-- Every existing company starts with exactly what it has today:
-- Junior < Senior, Low/Medium tickets start at Junior and High/Urgent
-- at Senior. Safe to re-run.
INSERT INTO AgentLevels (companyId, name, rank)
SELECT c.id, 'Junior', 1 FROM Companies c
WHERE NOT EXISTS (SELECT 1 FROM AgentLevels l WHERE l.companyId = c.id AND LOWER(l.name) = 'junior');

INSERT INTO AgentLevels (companyId, name, rank)
SELECT c.id, 'Senior', 2 FROM Companies c
WHERE NOT EXISTS (SELECT 1 FROM AgentLevels l WHERE l.companyId = c.id AND LOWER(l.name) = 'senior');

INSERT INTO PriorityRouting (companyId, priority, startLevelId, escalate, maxLevelId)
SELECT c.id, p.priority,
  (SELECT l.id FROM AgentLevels l WHERE l.companyId = c.id AND LOWER(l.name) = p.startName),
  true, NULL
FROM Companies c
CROSS JOIN (VALUES ('Low', 'junior'), ('Medium', 'junior'), ('High', 'senior'), ('Urgent', 'senior')) AS p(priority, startName)
WHERE NOT EXISTS (SELECT 1 FROM PriorityRouting r WHERE r.companyId = c.id AND r.priority = p.priority);
