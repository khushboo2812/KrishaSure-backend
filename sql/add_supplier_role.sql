-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- Adds the 'supplier' role: an outside vendor who supports one of the
-- company's systems. A supplier works tickets like an agent, but only
-- sees and receives tickets in their own categories (stored in their
-- Agents.skills, same as an agent's skills), and can't reassign or
-- recategorise tickets.
ALTER TABLE Memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE Memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('superadmin', 'agent', 'supplier', 'client', 'platform_owner'));
