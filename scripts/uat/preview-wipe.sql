-- Read-only. Run in the PRODUCTION SQL editor to see what is there
-- before you decide anything. Changes nothing.
SELECT (SELECT count(*) FROM companies) AS companies,
       (SELECT count(*) FROM people) AS people,
       (SELECT count(*) FROM memberships) AS memberships,
       (SELECT count(*) FROM clientorganizations) AS client_orgs,
       (SELECT count(*) FROM tickets) AS tickets,
       (SELECT count(*) FROM ticketcomments) AS comments,
       (SELECT count(*) FROM ticketattachments) AS attachment_records;

-- Every company and how much is in it:
SELECT c.id, c.name, c.companytype, c.isactive,
       (SELECT count(*) FROM memberships m WHERE m.companyid = c.id) AS users,
       (SELECT count(*) FROM tickets t WHERE t.companyid = c.id) AS tickets
FROM companies c ORDER BY c.id;

-- Who are the platform owners?
SELECT p.id, p.name, p.email, m.companyid
FROM memberships m JOIN people p ON p.id = m.personid
WHERE m.role = 'platform_owner';
