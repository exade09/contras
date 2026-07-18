# contras.fun

`contras.fun` is a read-only Counter-Strike 2 inventory viewer, public item
catalog, and manual sale-request application. It uses the Next.js App Router,
PostgreSQL through Drizzle ORM and postgres-js, and is designed for a standard
Vercel deployment.

The application is not an automated trading or payment platform. It does not:

- ask for or receive Steam passwords, Steam Guard codes, Steam cookies, or QR secrets;
- send or accept Steam trade offers;
- deposit, withdraw, buy, or custody items;
- collect payments or automatically settle a sale request;
- derive a client's requested sale amount from a catalog price.

Users browse public metadata, connect through official Steam OpenID, view their
read-only public CS2 inventory, and submit owned assets for manual review. An
administrator reviews requests and records any resulting off-platform deal
manually.

## Technology

- Node.js 22.18 or newer
- Next.js App Router and React
- PostgreSQL
- Drizzle ORM and postgres-js
- Official Steam OpenID 2.0 authentication
- Steam Community inventory endpoint for app `730`, context `2`, in English
- ByMykel/CSGO-API English catalog metadata
- Documented public Skinport market pricing with exact variant matching

Cloudflare Workers, Vinext, Wrangler, and D1 are not part of the production
runtime. The old SQLite/D1 migration history remains in `drizzle/` solely for
data-preservation and cutover reference.

## Local setup

1. Install Node.js 22.18 or newer and obtain a PostgreSQL database. A local
   PostgreSQL instance, Neon database, or Vercel-connected Postgres database is
   suitable.
2. Copy `.env.example` to `.env.local` and replace every required placeholder.
3. Install the exact dependency tree:

   ```bash
   npm ci
   ```

4. Apply the PostgreSQL migrations explicitly:

   ```bash
   npm run db:migrate
   ```

5. Start the application:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`.

The application never creates or alters tables from a request handler. Run the
migration command when provisioning a new database and whenever a reviewed
migration is added.

## npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Produce a standard Next.js production build. |
| `npm run start` | Serve the completed production build locally. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run deterministic Node tests. |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run db:generate` | Generate a reviewed PostgreSQL migration from the Drizzle schema. |
| `npm run db:migrate` | Apply pending migrations from `drizzle-postgres/`. |
| `npm run db:check` | Check migration metadata consistency. |
| `npm run db:studio` | Open Drizzle Studio against `DATABASE_URL`. |

The English-only source guard can also be run directly:

```bash
node scripts/check-english.mjs
```

## PostgreSQL

Set `DATABASE_URL` to a complete PostgreSQL connection URL. For a hosted
serverless database, use its pooled connection URL and require TLS as instructed
by the provider. The checked-in example has this shape:

```dotenv
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

The database client is created lazily, uses postgres-js with prepared statements
disabled for pooler compatibility, and defaults to one connection per Vercel
function instance. `DATABASE_POOL_MAX` may be raised deliberately, but the total
possible connections across concurrent serverless instances must remain below
the provider limit.

PostgreSQL migrations live in `drizzle-postgres/`. Do not edit a migration that
has already been applied. Update `db/schema.ts`, generate a forward migration,
review the SQL and snapshot, run `npm run db:check`, and apply it to a disposable
database before production.

## Environment variables

Never commit `.env`, `.env.local`, credentials, session material, API keys, or
database exports. Only `NEXT_PUBLIC_APP_URL` is intentionally visible to browser
code; every other secret stays server-side.

### Required for production

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled PostgreSQL connection URL. |
| `SESSION_SECRET` | At least 32 cryptographically random bytes used for application authentication and anti-forgery state. Do not reuse the admin password. |
| `NEXT_PUBLIC_APP_URL` | Exact canonical origin, for example `https://inventory.example.com`. It must not contain a path, query, fragment, or credentials. |
| `ADMIN_LOGIN` | Environment-backed administrator login while that bootstrap path is retained. |
| `ADMIN_PASSWORD` | Unique, non-placeholder environment-backed administrator password of at least 16 characters. The corresponding administrator identity must be materialized in PostgreSQL before a foreign-key-backed session is issued. |

### Database tuning

| Variable | Default | Purpose |
| --- | ---: | --- |
| `DATABASE_POOL_MAX` | `1` | Maximum postgres-js connections per runtime instance; capped by the application at 10. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | `10` | Database connection timeout. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | `20` | Idle connection lifetime. |

### Steam

| Variable | Required | Purpose |
| --- | --- | --- |
| `STEAM_API_KEY` | No | Reserved for optional server-side Steam profile enrichment such as display name and avatar. It is not required for OpenID verification or the public Community inventory endpoint. |
| `STEAMAPIS_API_KEY` | No | Server-only SteamApis fallback used only when Steam Community returns HTTP 429 for a public inventory. Keep it secret; the official Steam endpoint remains primary. |

### Public catalog

| Variable | Default | Purpose |
| --- | --- | --- |
| `CSGO_API_BASE_URL` | `https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/` | Server-side base URL for English `all.json` and `skins_not_grouped.json`. HTTPS is required except for loopback test fixtures. |
| `CSGO_API_CACHE_TTL_SECONDS` | `21600` | In-process catalog metadata cache lifetime; six hours by default. |

### Skinport pricing

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKINPORT_PRICE_CURRENCY` | `USD` | Currency requested from the documented public Skinport items endpoint. |
| `SKINPORT_PRICE_CACHE_TTL_SECONDS` | `300` | Fresh price-cache lifetime in seconds; five minutes by default. |

## Steam OpenID and inventory

Steam authentication must always redirect in the same browser tab to:

```text
https://steamcommunity.com/openid/login
```

The application constructs its realm and callback from `NEXT_PUBLIC_APP_URL`,
not from an untrusted `Host` header. For a production origin of
`https://inventory.example.com`, the callback path is:

```text
https://inventory.example.com/api/steam/callback?state=<single-use-state>
```

Production origins must use HTTPS. Loopback development may use
`http://localhost:3000`. Pick one canonical hostname, including the intended
`www` choice, and use it consistently. A Vercel preview URL is not automatically
a valid Steam origin: set a deliberate preview `NEXT_PUBLIC_APP_URL` before
testing Steam there, or defer Steam testing to the canonical deployment.

The OpenID boundary validates the callback origin and path, namespace, mode,
Steam endpoint, `return_to`, realm when present, claimed SteamID64, identity,
signed fields, response-nonce age, and application state. The signed assertion
must then be posted directly back to Steam with
`openid.mode=check_authentication`. State and Steam response nonces must be
consumed atomically in PostgreSQL so a callback cannot be replayed.

OpenID proves the SteamID64 without exposing Steam credentials. `STEAM_API_KEY`,
when configured, may enrich a linked account with public profile information;
its absence must not prevent sign-in, account linking, or inventory loading.
Profile enrichment with a real key has not yet been verified.

The inventory loader reads the English CS2 inventory for app `730`, context `2`,
joins assets to descriptions by `classid` and `instanceid`, follows Steam's
`more_items` and `last_assetid` pagination within a safety bound, and treats
Steam as authoritative for ownership, asset IDs, quantities, tradability, and
marketability. When Steam Community returns HTTP 429, an optional server-only
`STEAMAPIS_API_KEY` can retry the same public inventory through SteamApis; the
fallback response is validated against the same ownership schema. CSGO-API
metadata is enrichment only. A private or unavailable inventory must not
prevent use of the public catalog.

Only a current `steam_links` row created through verified OpenID is accepted as
proof of a connected identity. The legacy `users.steam_id` column is retained
for migration review but cannot authorize inventory reads or sale requests.

## Public CS2 catalog

The server requests the official English ByMykel documents:

- `all.json` for the complete supported item set;
- `skins_not_grouped.json` for normalized weapon-skin variants.

The normalizer preserves stable upstream IDs and exact `market_hash_name` values,
deduplicates without using display names as the only key, retains upstream rarity
names/colors and images, and supports category, weapon, rarity, wear, search,
sorting, and pagination.

Catalog metadata is cached separately from prices. The default in-process
metadata TTL is six hours. Fetches use a 12-second timeout, bounded retries for
transient failures and rate limits, and request coalescing. If the upstream fails,
the most recent in-memory snapshot is marked as last-known-good and stale. If no
upstream snapshot exists, the bundled English fixture is returned and marked as
a bundled fallback. Fallbacks retry after five minutes. The catalog response also
uses CDN cache headers, while callers still receive source and stale metadata.

The in-memory last-known-good cache is per serverless instance, not a durable
cross-deployment cache. The bundled fixture is the deterministic outage floor.

## Skinport price status

Production pricing uses Skinport's documented public `GET /v1/items` endpoint
for app `730` with `tradable=0`. It requires no API key, is cached by Skinport
for five minutes, and is fetched no more often than the application price-cache
TTL. The lowest current listing is preferred; when no listing exists, Skinport's
`suggested_price` is used. No HTML pages or private browser endpoints are scraped.

Values are normalized as positive integer minor units plus an ISO three-letter
currency and optional update time.
Currency fraction digits are derived through `Intl.NumberFormat`, so currencies
are not assumed to always have two decimals. Exact `market_hash_name` matching is
used; fuzzy matching is prohibited. Items without an exact Skinport match remain
visible and explicitly show that the price is unavailable.

The price cache is separate from catalog metadata. Its default fresh lifetime is
five minutes, with a 30-minute stale-while-revalidate window. A cached or
timestamp-old value must be labeled stale. Provider failure must leave catalog
metadata usable and display `Price unavailable` or
`Price temporarily unavailable`.

Catalog prices are informational only. They never set or overwrite the amount a
client requests and never trigger a trade, payment, acceptance, or admin status
change.

## Manual sale requests and deals

Only assets returned by the connected user's Steam inventory may be selected.
The client submits asset IDs, a desired amount, a supported currency, and an
optional note. The server must re-check the current connected identity,
ownership, duplicates, item count, amount, currency, and cancellation/status
rules before persisting an immutable item snapshot.

The administrator receives the client and Steam identity, profile link, owned
asset IDs and item snapshots, desired amount, currency, note, timestamps, and
status. Administrators review and update requests manually. Clients may cancel a
pending request when allowed. Disconnecting Steam does not delete the application
account, requests, deals, or admin records.

Recorded deals are administrative history. They do not prove that this
application transferred an item or payment.

## Vercel deployment

Use a normal Next.js project; no Cloudflare adapter or custom output directory is
required.

Recommended project settings:

- Framework preset: Next.js
- Root directory: repository root
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: leave unset so Vercel uses the standard `.next` output
- Node.js: a release satisfying `>=22.18.0`

Deployment sequence:

1. Create the target PostgreSQL database and copy its pooled URL.
2. Configure all required environment variables separately for Preview and
   Production. Keep database, session, admin, and Steam secrets
   server-only.
3. Run `npm run db:migrate` explicitly against the target database from an
   approved environment.
4. Deploy the standard Next.js build. Do not run migrations from request
   handlers or automatically on every build.
5. Set `NEXT_PUBLIC_APP_URL` to the deployed canonical HTTPS origin and redeploy
   if it changed.
6. Complete the post-deployment checks below before directing users to the site.

A `vercel.json` file is not required for this configuration. The application
must not depend on production filesystem writes or long-running workers.

## Legacy D1 data

The original SQLite/D1 migrations are preserved in `drizzle/`; they are not
compatible with PostgreSQL and must never be executed against `DATABASE_URL`.
The PostgreSQL baseline is in `drizzle-postgres/`.

No deployed D1 database, binding configuration, export, or Cloudflare credential
is present in this checkout. Consequently, preserving live D1 data remains a
deployment blocker, not something the application can infer locally. Do not cut
production over until an authorized export is available and validated.

See [D1 to PostgreSQL cutover](docs/d1-to-postgres.md) for the safe staging,
ordering, validation, and rollback process. The key requirements are to preserve
IDs and integer cents, materialize or map the legacy `env-admin` identity before
foreign keys are enforced, import parent rows before child rows, skip expired
authentication state, and compare counts and orphan checks before switching
traffic.

## Verification and post-deployment checks

Before every release, run:

```bash
npm ci
npm run lint
npm run typecheck
npm test
node scripts/check-english.mjs
npm run db:check
npm run build
```

After deployment, verify manually:

1. The landing, authentication, inventory, catalog, requests, and admin pages are
   English-only and load without browser console or failed asset errors.
2. PostgreSQL data survives a fresh function instance and a redeployment.
3. Admin login and role boundaries work, blocked users lose their sessions, and
   normal users cannot access admin routes.
4. The catalog loads, searches, filters, sorts, paginates, and remains available
   when the upstream is deliberately unavailable.
5. Skinport prices load through the documented public endpoint, exact variants
   match by `market_hash_name`, and missing prices remain explicit.
6. Connect Steam redirects only to `steamcommunity.com/openid/login`, and the
   callback uses the exact canonical origin.
7. Using a real Steam account, test first sign-in, repeat sign-in, existing-account
   linking, duplicate-link rejection, disconnect, public inventory, private
   inventory, and at least one paginated inventory where available.
8. Submit only selected owned assets, inspect the immutable admin payload, update
   status, cancel an allowed pending request, and confirm no Steam offer or
   payment is produced.
9. Review logs and responses to confirm that database URLs, session material,
   Steam data beyond the documented profile fields, API keys, cookies, and
   credentials are not exposed.

Current external-verification status:

- Steam OpenID start and the public/private inventory states are covered by tests;
  complete callback behavior still requires a real Steam account smoke test.
- Public Steam profile enrichment has been verified against a real SteamID; the
  API-key Web API branch remains covered by deterministic tests.
- The documented public Skinport items response has been verified with live data.
- The application has been deployed to Vercel and its production build verified.
- Live D1 data has not been exported or imported into PostgreSQL.

Do not describe any of those external paths as working until the corresponding
manual verification has actually succeeded.
