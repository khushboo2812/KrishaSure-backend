-- Run by hand in the Supabase SQL editor (this repo has no migration
-- runner — schema is managed directly in Supabase).
--
-- One-time cleanup: every supportEmail generated so far was built on
-- the root krishasure.io domain, whose MX records point at GoDaddy's
-- real mail hosting (staff mailboxes) — those addresses bounce before
-- ever reaching Resend. The app now generates new addresses on
-- tickets.krishasure.io, a dedicated subdomain fully verified in
-- Resend for inbound receiving. This moves every already-generated
-- address over to the working domain, keeping the same local part
-- (e.g. acme-support@krishasure.io -> acme-support@tickets.krishasure.io)
-- so nothing needs to be regenerated or re-deduped.

UPDATE ClientOrganizations
  SET supportEmail = REPLACE(supportEmail, '@krishasure.io', '@tickets.krishasure.io')
  WHERE supportEmail LIKE '%@krishasure.io';

UPDATE Companies
  SET supportEmail = REPLACE(supportEmail, '@krishasure.io', '@tickets.krishasure.io')
  WHERE supportEmail LIKE '%@krishasure.io';
