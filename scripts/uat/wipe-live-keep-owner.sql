-- DANGER: deletes almost everything in the database you run it in.
--
-- Run it ONLY in the PRODUCTION Supabase SQL editor, and ONLY after:
--   1. you have a backup file of production on your computer, and
--   2. the UAT copy of the data is checked and works.
--
-- What it keeps:
--   * your own person record (your login and password),
--   * your platform-owner membership,
--   * the company that membership belongs to (it has to exist for the
--     login to work; it ends up empty),
--   * the PlatformSettings table.
-- Everything else is emptied: every other company, user, client
-- organisation, ticket, comment, attachment record, rule and level. Ticket numbers start again
-- at KS-001. It all happens in one go: if anything is wrong it stops
-- and changes nothing.
--
-- BEFORE YOU RUN IT: change the email on the line marked  <<<  below.
-- (Attachment FILES in Storage are not touched; empty that bucket
-- yourself in Supabase once you are sure.)
DO $$
DECLARE
  owner_email text := 'CHANGE-ME@example.com';  -- <<< your login email
  keep_person bigint;
  tbls text;
  t text;
BEGIN
  IF owner_email LIKE 'CHANGE-ME%' THEN
    RAISE EXCEPTION 'Stopped: edit the line marked <<< and put your own login email in owner_email.';
  END IF;

  SELECT id INTO keep_person FROM people WHERE lower(email) = lower(owner_email);
  IF keep_person IS NULL THEN
    RAISE EXCEPTION 'Stopped: nobody with the email % was found.', owner_email;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE personid = keep_person AND role = 'platform_owner') THEN
    RAISE EXCEPTION 'Stopped: % is not a platform owner, so the login would not survive.', owner_email;
  END IF;

  -- Set aside what we keep.
  CREATE TEMP TABLE keep_people ON COMMIT DROP AS SELECT * FROM people WHERE id = keep_person;
  CREATE TEMP TABLE keep_memberships ON COMMIT DROP AS
    SELECT * FROM memberships WHERE personid = keep_person AND role = 'platform_owner';
  CREATE TEMP TABLE keep_companies ON COMMIT DROP AS
    SELECT * FROM companies WHERE id IN (SELECT companyid FROM keep_memberships);

  -- Empty every table except PlatformSettings (names come from the
  -- database itself, so no table is missed).
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tbls FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'platformsettings';
  EXECUTE 'TRUNCATE ' || tbls || ' RESTART IDENTITY CASCADE';

  -- Put back only what we kept.
  INSERT INTO companies OVERRIDING SYSTEM VALUE SELECT * FROM keep_companies;
  INSERT INTO people OVERRIDING SYSTEM VALUE SELECT * FROM keep_people;
  INSERT INTO memberships OVERRIDING SYSTEM VALUE SELECT * FROM keep_memberships;

  -- New rows must not reuse the ids we just put back.
  FOREACH t IN ARRAY ARRAY['companies', 'people', 'memberships'] LOOP
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, ''id''), COALESCE((SELECT max(id) FROM %I), 1), true)', t, t);
  END LOOP;
END $$;

-- Check the result: you should see 1 company, 1 person, 1 membership and 0 tickets.
SELECT (SELECT count(*) FROM companies) AS companies,
       (SELECT count(*) FROM people) AS people,
       (SELECT count(*) FROM memberships) AS memberships,
       (SELECT count(*) FROM tickets) AS tickets;
