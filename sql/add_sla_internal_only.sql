-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- An MSP's tickets are either tied to a client org, or "internal"
-- (clientOrgId NULL — the MSP's own tickets, not filed on behalf of
-- any client). Before this, a rule with clientOrgId NULL was the
-- fallback for BOTH cases at once — there was no way to give internal
-- tickets their own SLA distinct from "whatever a client-org ticket
-- gets when it has no more specific override." internalOnly, when
-- true, scopes a rule to internal tickets only (clientOrgId must be
-- NULL on such a rule — the two are mutually exclusive, same as a
-- ticket itself is either tied to one client org or is internal, never
-- both). Defaults to false, so every existing rule keeps meaning
-- exactly what it already means.
ALTER TABLE SLARules
  ADD COLUMN IF NOT EXISTS internalOnly BOOLEAN NOT NULL DEFAULT false;
