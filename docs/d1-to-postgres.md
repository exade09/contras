# D1 to PostgreSQL cutover

This document describes a data-preserving cutover from the legacy Cloudflare D1
database to the PostgreSQL schema in `drizzle-postgres/`. It is an operational
runbook, not an automated migration: this checkout does not contain the deployed
D1 binding, its credentials, or a live export.

Never execute the SQLite files in `drizzle/` against PostgreSQL. Never commit a
database export. Treat exports as sensitive because they contain account data,
password hashes, IP hashes, session hashes, Steam identities, notes, and deal
history.

## Blockers and required access

Before scheduling a cutover, obtain:

- authorization to read and export the production D1 database;
- the exact Cloudflare account, database name or ID, and environment;
- an encrypted destination for the export and any transformed staging data;
- a new PostgreSQL database with a tested backup/restore path;
- an identified maintenance window or a reviewed dual-write strategy;
- an application build that reads PostgreSQL exclusively and passes all checks.

The removed starter binding and placeholder configuration are not evidence of
the live database identity. Use the authenticated Cloudflare environment that
owns the deployment. Confirm the target before running an export.

## 1. Take and protect the D1 export

Use authenticated Cloudflare tooling to create a consistent remote export. The
exact command and database identifier depend on the production account and must
be confirmed by its owner. Do not guess an ID from old source files.

Record, without placing secrets in Git:

- export time and source environment;
- D1 database identifier;
- export file byte size and SHA-256 digest;
- table names and row counts;
- application commit serving traffic at export time.

Store the original export read-only and encrypted. Work from a copy. If the
application remains writable after the export, that copy is only a rehearsal;
take a final export after writes are paused.

## 2. Create an isolated PostgreSQL target

Create an empty staging database and set `DATABASE_URL` only in the approved
migration environment. Apply the PostgreSQL baseline:

```bash
npm ci
npm run db:check
npm run db:migrate
```

Do not point a local migration rehearsal at the production PostgreSQL database.
Do not place `npm run db:migrate` in a request handler or an automatic per-request
initialization path.

## 3. Preflight legacy data

D1 did not enforce the PostgreSQL foreign keys and checks. Produce a report for:

- duplicate or invalid user logins;
- Steam IDs that are not 17 digits;
- duplicate Steam IDs across `users.steam_id` and `steam_links.steam_id`;
- sessions, links, deals, requests, or child items whose parent user/record is missing;
- deals whose `created_by` user is missing;
- unsupported role, account, deal, request-status, source, or currency values;
- invalid or out-of-range integer amounts and quantities;
- malformed ISO timestamps or deal dates;
- request items with missing or duplicate asset IDs;
- the synthetic `env-admin` ID referenced by sessions, Steam links, or deals.

Resolve every conflict with a written rule. Never silently discard a row or
attach it to a different user. Legacy request items without an asset ID may be
retained as explicitly marked historical records, but they must never become
proof of current ownership or be resubmitted as owned assets.

## 4. Transform without losing semantics

Use a reviewed, deterministic, idempotent importer or staging process. It should:

- preserve all existing text IDs;
- preserve currency amounts as integer minor units, never through floating point;
- convert ISO text timestamps to `timestamptz` and `deal_date` to `date`;
- convert D1 integer booleans to PostgreSQL booleans;
- keep notes and display text as UTF-8 without lossy normalization;
- derive no prices, ownership, or missing business data;
- record rejected rows and stop rather than partially hiding errors;
- support a dry-run that makes no target changes;
- run each import phase in a transaction and be safe to repeat.

The PostgreSQL schema uses foreign keys. Before dependent rows are imported,
materialize a real administrator row or map every `env-admin` reference to a
reviewed persistent administrator ID. Do not insert an environment password or
other secret into a migration file.

## 5. Import in dependency order

Use this order unless the reviewed importer provides an equivalent staged
foreign-key-safe transaction:

1. `users`, including the approved persistent administrator mapping;
2. `steam_links` and optional public profile fields;
3. unexpired `sessions`, only if preserving them has been explicitly approved;
4. `login_events`;
5. `deals`;
6. `deal_items`;
7. `trade_requests`;
8. `trade_request_items`.

Do not import expired `steam_auth_states`; require users to begin a new Steam
OpenID attempt. Prefer invalidating all legacy sessions at cutover unless session
continuity has a reviewed security requirement. Session hashes are not portable
proof that the new cookie/session configuration is valid.

Populate new snapshot/profile columns only from trustworthy legacy fields. Leave
unknown nullable fields null and the JSON snapshot empty or explicitly marked as
legacy. Do not invent Steam metadata.

## 6. Validate the staged result

At minimum, compare:

- source and target row counts per imported table;
- stable-ID sets and per-table deterministic checksums;
- totals of integer cents grouped by currency and status;
- counts grouped by role, account status, deal status, and request status;
- Steam-ID uniqueness;
- zero orphan rows for every foreign key;
- representative users, deals, requests, child items, notes, and timestamps;
- application reads through user and admin endpoints.

Run the full deterministic verification suite and smoke-test the staging build.
Do not treat matching total row counts alone as sufficient.

## 7. Production cutover

1. Announce the maintenance window and stop D1 writes.
2. Take and checksum the final D1 export.
3. Re-run preflight and the rehearsed transformation.
4. Import into the production PostgreSQL database.
5. Repeat all count, checksum, orphan, currency-total, and sample validation.
6. Apply the PostgreSQL-only application configuration and deploy.
7. Verify login, roles, inventory, sale requests, admin review, and persistence.
8. Monitor errors and database connection counts before restoring normal access.

Keep the D1 export and previous deployment available, read-only, for the agreed
rollback period. A rollback must account for any writes accepted by PostgreSQL
after cutover; simply switching traffic back can lose or fork data.

## 8. Closeout

After the rollback window:

- create and test a PostgreSQL backup;
- record final checksums, counts, deployment commit, and verification results;
- revoke temporary Cloudflare and database credentials;
- securely delete working export copies according to the retention policy;
- keep only the approved encrypted archive and migration report;
- do not remove the historical `drizzle/` migrations until data-retention and
  audit requirements permit it.
