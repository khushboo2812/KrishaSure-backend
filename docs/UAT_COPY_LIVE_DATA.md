# Move the live data to UAT, then clear live

Goal: UAT holds a copy of everything that is in the live database today, and the live database is left clean with only the platform owner's login.

Order matters. Do not skip a check, and do the wipe last.

1. **Back up live.** From a computer with the PostgreSQL client tools (the same major version as the Supabase project, shown under Project Settings, Infrastructure):
   `pg_dump "LIVE_SESSION_POOLER_URL" -Fc -f krishasure-live-backup.dump`
   Keep that file somewhere safe. It is the only way back after the wipe.
2. **Look before you move.** Run `scripts/uat/preview-wipe.sql` in the live SQL editor and note the numbers.
3. **Create the UAT Supabase project** (empty), and its private `ticket-attachments` bucket.
4. **Copy structure and data:**
   `pg_dump "LIVE_SESSION_POOLER_URL" --no-owner --no-privileges --schema=public | psql "UAT_SESSION_POOLER_URL"`
   Use the Session pooler connection strings from each project's Connect screen (they work over IPv4).
5. **Check the copy.** Run the count part of `preview-wipe.sql` in the UAT editor. The numbers must match step 2.
6. **Deploy and test UAT** (Render service on branch `uat`, Vercel domain, secrets that differ from live). Log in with a real account and open some tickets. Emails from UAT only reach the allow-list.
7. **Attachment files** are stored separately from the database. If old tickets need their files in UAT, copy the `ticket-attachments` bucket too; otherwise those files won't open in UAT.
8. **Only now, wipe live.** Edit the email line in `scripts/uat/wipe-live-keep-owner.sql` and run it in the live SQL editor. It refuses to run if the email is not a platform owner, and it runs as one step: all or nothing. Check the four counts it returns: 1, 1, 1, 0.
9. **Empty the live attachments bucket** in Supabase Storage.
10. **Log in to live** as the platform owner and confirm it works.
