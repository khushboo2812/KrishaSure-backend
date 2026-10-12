---
title: KrishaSure UAT Environment
subtitle: A separate test copy of KrishaSure, set up step by step
date: 12 October 2026
---

# What this is

UAT is a complete second copy of KrishaSure for testing. It has its own website, its own server, its own database, its own file storage and its own secret keys. Nothing you do in UAT can touch production, and production keeps running as it is.

| | Production | UAT |
| --- | --- | --- |
| Website | app.krishasure.io (Vercel) | uat.krishasure.io (Vercel) |
| Server | api.krishasure.io (Render) | uat-api.krishasure.io (Render) |
| Code branch | `master` | `uat` |
| Database and file storage | Production Supabase project | A new, separate Supabase project |
| Email | Real emails to real people | Only to addresses on an allow-list, subject starts with "[UAT]" |
| Inbound email addresses | tickets.krishasure.io | tickets-uat.krishasure.io |
| AI (Gemini) | Production key | A different key, so UAT testing never uses up production's daily AI quota |
| Data | Real | Fake test data only |

## Built-in safety

- **Email guard.** In UAT the server only delivers email to addresses on `UAT_EMAIL_ALLOWLIST`. Anyone else is dropped and logged, so a test can never email a real client.
- **Database guard.** Set `PRODUCTION_DB_HOST` on the UAT server. If it is ever pointed at the production database it refuses to start. The seed and reset scripts check the same thing.
- **Banner.** The UAT website shows an orange "TEST ENVIRONMENT" bar, and the browser tab says "[UAT]".
- **Separate secrets.** UAT has its own login-token secret, so a production login never works on UAT, and the other way round.

# Before you start

You need accounts you already have: GitHub, Supabase, Render, Vercel, Resend, Google AI Studio and your domain provider (GoDaddy). Allow about 1 to 2 hours, mostly waiting for DNS. A computer is easier than a phone for steps 2 and 7.

Do the steps in order. Anything marked **Claude** is something I can do for you in this chat.

# Step 1. Merge the code changes (Claude)

Two pull requests make both apps UAT-ready without changing how production behaves. With no UAT settings present, they are the production app exactly as it is today.

1. Merge the backend pull request, then the frontend pull request.
2. Say "merge now" in the chat and I'll do both, then create the `uat` branch in each repository from `master`.

# Step 2. Create the UAT database

1. In Supabase click **New project**. Name it `krishasure-uat`, choose the same region as production, and save the database password somewhere safe.
2. Open **Project Settings, Database**, and copy the **connection string** (the same kind you use for production). This becomes `SUPABASE_DB_URL`.
3. Open **Project Settings, API** and copy the **Project URL** (`SUPABASE_URL`) and the **service_role key** (`SUPABASE_SERVICE_KEY`).
4. Open **Storage, New bucket**. Name it exactly `ticket-attachments` and keep it **private**.

## Copy the table structure (no data) from production

Production's tables are not stored in the code repository, so they are copied from production. This only reads, and copies no data.

1. Open the **production** Supabase project, then **SQL Editor, New query**.
2. Paste the contents of `scripts/uat/export-schema.sql` (in the backend repository) and click **Run**.
3. The result is one cell of text called `schema_sql`. Copy that cell.
4. Open the **UAT** Supabase project, then **SQL Editor, New query**. Paste what you copied and click **Run**.
5. Check **Table Editor**. You should see the same table names as production, all empty.

If you have a computer with the PostgreSQL tools, this does the same job: `pg_dump --schema-only --no-owner --no-privileges "PRODUCTION_URL" | psql "UAT_URL"`.

# Step 3. Create the UAT server on Render

1. In Render click **New, Web Service** and connect the `krishasure-backend` repository.
2. Name it `krishasure-uat`. Set the **branch** to `uat`. Copy the **build command** and **start command** from your production service (normally `npm install` and `npm start`).
3. Add these environment variables:

| Variable | UAT value |
| --- | --- |
| `APP_ENV` | `uat` |
| `APP_URL` | `https://uat.krishasure.io` |
| `API_URL` | `https://uat-api.krishasure.io` |
| `SUPPORT_EMAIL_DOMAIN` | `tickets-uat.krishasure.io` |
| `SUPABASE_DB_URL` | The UAT connection string from Step 2 |
| `SUPABASE_URL` | The UAT project URL |
| `SUPABASE_SERVICE_KEY` | The UAT service_role key |
| `PRODUCTION_DB_HOST` | Only the host part of the production connection string (for example `db.abcdefgh.supabase.co`) |
| `JWT_SECRET` | A new long random value. Never reuse production's |
| `GEMINI_API_KEY` | A key from a different Google AI Studio project |
| `RESEND_API_KEY` | A new Resend API key (Step 5) |
| `EMAIL_FROM` | A UAT sender address on a domain verified in Resend |
| `UAT_EMAIL_ALLOWLIST` | Your own address(es), for example `you@krishasolutions.net`. Add `@krishasolutions.net` to allow the whole domain |

4. Under **Settings, Custom Domains** add `uat-api.krishasure.io`. Render shows the DNS record to create (Step 6).
5. Deploy. Open the Render URL: you should see `"environment":"uat"` in the response.

Render's free plan puts a server to sleep when idle, and a sleeping server does not run the hourly jobs (escalation, Pending reminders). To test those, use a paid instance, or trigger them by hand (see Step 8).

# Step 4. Create the UAT website on Vercel

1. In your Vercel project for the web app open **Settings, Environment Variables** and add two variables for the **Preview** environment, limited to the Git branch `uat`:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://uat-api.krishasure.io` |
| `VITE_APP_ENV` | `uat` |

2. Open **Settings, Domains**, add `uat.krishasure.io` and assign it to the Git branch `uat`.
3. Push or redeploy the `uat` branch. Vercel builds it with the UAT settings.

Production is not affected: without those two variables the app talks to `api.krishasure.io` and shows no banner.

# Step 5. Email (Resend)

1. In Resend create a **new API key** named `uat` and use it as `RESEND_API_KEY` on the UAT server.
2. Outgoing mail: use a sender address on a domain you have already verified, set as `EMAIL_FROM`.
3. Incoming mail (only needed to test "email becomes a ticket"): add the domain `tickets-uat.krishasure.io` in Resend, enable receiving, and add the DNS records Resend shows. Then add a webhook for `email.received` pointing to `https://uat-api.krishasure.io/api/inbound-email`.

# Step 6. DNS records at GoDaddy

| Type | Name | Points to |
| --- | --- | --- |
| CNAME | `uat` | The value Vercel shows for `uat.krishasure.io` |
| CNAME | `uat-api` | The value Render shows for `uat-api.krishasure.io` |
| MX and TXT | `tickets-uat` | The records Resend shows (Step 5.3) |

DNS usually updates within minutes and can take a few hours.

# Step 7. Load the test data

This creates fake companies, users in every role, and tickets in the states you need. Run it on a computer (or ask me to walk you through GitHub Codespaces):

```
git clone https://github.com/khushboo2812/krishasure-backend.git
cd krishasure-backend
git checkout uat
npm install
cp .env.example .env      # then fill in the UAT values from Step 3
UAT_SEED_PASSWORD='choose-a-password' UAT_SEED_TESTER_EMAIL='you@yourdomain.com' npm run uat:seed
```

- Every test account gets the password you choose.
- With `UAT_SEED_TESTER_EMAIL` set, each test user's address becomes a "plus address" of yours (`you+msp-admin@yourdomain.com`), so notification emails for every test user arrive in your own inbox.
- It is safe to run again: existing data is kept.
- To wipe UAT and start fresh: `npm run uat:reset`, then run the seed again. It only runs when `APP_ENV=uat` and refuses to touch the production database.

## The test accounts

| Role | Company | Name | Address tag |
| --- | --- | --- | --- |
| Platform owner | KrishaSure UAT Platform | UAT Platform Owner | `platform-owner` |
| Superadmin | UAT MSP Demo | Mia Admin | `msp-admin` |
| Agent, Junior | UAT MSP Demo | Jon Junior | `msp-junior` |
| Agent, Senior | UAT MSP Demo | Sara Senior | `msp-senior` |
| Supplier (ERP only) | UAT MSP Demo | Sam Supplier | `msp-supplier` |
| Client of "Client One" | UAT MSP Demo | Cleo One | `msp-client-one` |
| Client of "Client Two" | UAT MSP Demo | Cal Two | `msp-client-two` |
| Superadmin | UAT Internal Co | Ina Admin | `internal-admin` |
| Agent | UAT Internal Co | Ian Agent | `internal-agent` |
| Client | UAT Internal Co | Ivy Employee | `internal-client` |
| In both companies | UAT Internal Co, UAT MSP Demo | Max Both | `multi` |

Without a tester address the logins are `tag@uat.krishasure.test`. With one they are `you+tag@yourdomain.com`.

The MSP company has two client organisations ("Client One" with a 40-hour monthly contract, and "Client Two" with none), categories General, Hardware, Network and ERP, escalation switched on, and six tickets.

# Step 8. Check it works

1. Open `uat.krishasure.io`. You should see the orange test banner and "[UAT]" in the tab.
2. Open `uat-api.krishasure.io`. It should say `"environment":"uat"`.
3. Log in as Mia Admin. You should see only the seeded tickets.
4. Log in as the platform owner and open the Platform Dashboard.
5. Trigger the hourly jobs by hand. As the platform owner, call `POST /api/companies/run-escalation-check` on the UAT server. It returns one line for every ticket saying what happened. I can give you the small script that does this.

# What to test in UAT

| Area | What to try | Seeded data to use |
| --- | --- | --- |
| Escalation | Run the escalation check. The "VPN drops" ticket moves from Jon Junior to Sara Senior | Medium ticket, 5 days old |
| Pending | The Pending ticket is 4 days old, so the reminder is due | "Waiting on the client" ticket |
| Roles | Each role sees only what it should: clients see their own tickets, the supplier sees only ERP | All test accounts |
| Several companies | Log in as Max Both and choose a company | `multi` |
| Client organisations | Per-client SLA rules, business hours, hours contract and balance | Client One |
| Email in | Add a client user using your real address, then email the MSP address. Only addresses on the allow-list get replies | `uat-msp-demo-support@tickets-uat.krishasure.io` |
| AI | Create a ticket and ask for an AI suggestion | Needs the UAT Gemini key |
| Plan limits | Change a company's limits and turn on enforcement | Platform Dashboard |
| Attachments | Upload and download a file | Needs the `ticket-attachments` bucket |
| SLA rules | Add, edit and delete a rule | Settings, SLA Rules |
| Password reset and welcome emails | Send to an allow-listed address | Any |

# The normal flow from now on

1. I build a change on a branch and open a pull request into **`uat`**.
2. You say "merge now" and it deploys to UAT automatically.
3. You test it in UAT.
4. When you are happy, I open a pull request from `uat` into `master`, and production gets it.
5. A fix made directly on `master` is merged back into `uat` so the two stay in step.

SQL changes: run each new SQL file on the UAT database first, test, and only then on production.

# Rules for staying safe

- Never copy production data into UAT. Use the seed script.
- Never reuse production keys or secrets in UAT.
- Keep `UAT_EMAIL_ALLOWLIST` short. Real client addresses never go on it.
- Do not give the UAT address to real clients or Alfazance, except in a planned demo.

# Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| The server will not start and the log says "Refusing to start" | `SUPABASE_DB_URL` points at the production database. Use the UAT one |
| No emails arrive | The address is not on `UAT_EMAIL_ALLOWLIST`. The Render log shows "[UAT] Email blocked" |
| The website says it cannot reach the server | `VITE_API_URL` is wrong or missing in Vercel, or the DNS for `uat-api` has not updated yet |
| Logging in fails with an unknown error | The tables are missing. Run Step 2 again |
| Attachments fail | The `ticket-attachments` bucket does not exist in the UAT Supabase project |
| AI says unavailable | The `GEMINI_API_KEY` is missing, or the free daily quota is used up |
| The seed says "Refusing to run" | `APP_ENV` is not `uat`, or the database looks like production |
