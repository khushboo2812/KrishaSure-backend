-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- The 'admin' role is being retired: it differed from 'superadmin' by
-- exactly two things (granting superadmin itself, and one safety-net
-- check), which made the two roles confusing without adding real
-- separation. From here on, a company's only management role is
-- superadmin. Promote every existing admin membership to superadmin
-- (a no-op today — there are none — but this is the correct migration
-- regardless of when it's run), then tighten the CHECK constraint so
-- 'admin' can never be inserted again even by a future bug.
UPDATE Memberships SET role = 'superadmin' WHERE role = 'admin';

ALTER TABLE Memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE Memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('superadmin', 'agent', 'client', 'platform_owner'));
