-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Step 1 of the multi-company identity migration: purely additive.
-- Creates People (one row per real human — name, email, password) and
-- Memberships (one row per person+company pairing — role, companyId,
-- clientOrgId), then copies every existing Users row across. The old
-- Users table is left completely untouched by this file, so the
-- currently-deployed backend code keeps working unmodified against it
-- right up until the new backend code (which reads/writes People and
-- Memberships instead) is deployed. That backend deploy is the one
-- moment behavior actually changes — this migration by itself changes
-- nothing anyone can observe.
--
-- App-level duplicate-email checks (routes/users.js, routes/companies.js)
-- mean there are no existing email collisions in Users to resolve here —
-- this is a clean 1:1 copy, not a merge.
--
-- People.id intentionally preserves the source Users.id (explicit id in
-- the INSERT, not a fresh identity value) rather than generating new
-- ids. Nothing in this schema foreign-keys on Users.id today, so this
-- isn't required for correctness — but any JWT issued before the code
-- cutover carries the old Users.id as its id claim, and preserving the
-- same numeric id means that claim still resolves to the right row
-- immediately after cutover, rather than every existing session being
-- silently invalidated.
--
-- After this backend has been running against People/Memberships for a
-- while and everything is confirmed working, rename Users to
-- Users_deprecated (not an immediate DROP) as a cheap rollback net, and
-- drop it for real later once confident. That step is intentionally NOT
-- part of this file — do it manually, separately, once ready.

CREATE TABLE IF NOT EXISTS People (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  mustChangePassword BOOLEAN NOT NULL DEFAULT false,
  emailVerified BOOLEAN NOT NULL DEFAULT false,
  emailVerifiedAt TIMESTAMPTZ,
  verificationToken TEXT,
  verificationTokenExpiry TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS Memberships (
  id BIGSERIAL PRIMARY KEY,
  personId BIGINT NOT NULL REFERENCES People(id) ON DELETE CASCADE,
  companyId BIGINT NOT NULL REFERENCES Companies(id),
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'agent', 'client', 'platform_owner')),
  clientOrgId BIGINT REFERENCES ClientOrganizations(id),
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (personId, companyId)
);

CREATE INDEX IF NOT EXISTS idx_memberships_personid ON Memberships (personId);
CREATE INDEX IF NOT EXISTS idx_memberships_companyid ON Memberships (companyId);

-- Copy every existing Users row into People, preserving id (see note above).
INSERT INTO People (id, name, email, password, mustChangePassword, emailVerified, emailVerifiedAt, verificationToken, verificationTokenExpiry, createdAt)
SELECT id, name, email, password, mustChangePassword, emailVerified, emailVerifiedAt, verificationToken, verificationTokenExpiry, createdAt
FROM Users
ON CONFLICT (id) DO NOTHING;

-- Keep the People.id sequence ahead of the ids we just inserted
-- explicitly, so the next INSERT ... DEFAULT (no explicit id) doesn't
-- collide with a preserved id.
SELECT setval(pg_get_serial_sequence('People', 'id'), COALESCE((SELECT MAX(id) FROM People), 1));

-- One Membership per existing Users row, carrying over their
-- company/role/client-org assignment exactly as it is today.
INSERT INTO Memberships (personId, companyId, role, clientOrgId)
SELECT id, companyId, role, clientOrgId
FROM Users
ON CONFLICT (personId, companyId) DO NOTHING;
