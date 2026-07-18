import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PostgreSQL persistence enforces unique Steam identities, replay nonces, and owned asset snapshots", async () => {
  const [migration, callbackRoute, tradeRoute] = await Promise.all([
    readFile("drizzle-postgres/0000_vercel_postgres_foundation.sql", "utf8"),
    readFile("app/api/steam/callback/route.ts", "utf8"),
    readFile("app/api/trade-requests/route.ts", "utf8"),
  ]);
  assert.match(migration, /CREATE UNIQUE INDEX "steam_links_steam_id_unique"/);
  assert.match(migration, /CREATE UNIQUE INDEX "steam_auth_states_response_nonce_unique"/);
  assert.match(migration, /CREATE UNIQUE INDEX "trade_request_items_request_asset_unique"/);
  assert.match(callbackRoute, /isNull\(steamAuthStates\.consumedAt\)/);
  assert.match(callbackRoute, /openIdResponseNonceHash: responseNonceHash/);
  assert.match(callbackRoute, /db\.transaction/);
  assert.match(tradeRoute, /selectVerifiedOwnedAssets/);
  assert.match(tradeRoute, /configuredSteamInventoryLoader\.load\(user\.steamId, \{ forceRefresh: true \}\)/);
  assert.doesNotMatch(tradeRoute, /\bloadSteamInventory\(/);
  assert.match(tradeRoute, /ownershipSource: "Steam Community Inventory"/);
});

test("inventory display and sale ownership verification share the resilient production loader", async () => {
  const [inventoryRoute, configuredLoader] = await Promise.all([
    readFile("app/api/inventory/route.ts", "utf8"),
    readFile("lib/server/configured-steam-inventory.ts", "utf8"),
  ]);
  assert.match(inventoryRoute, /configuredSteamInventoryLoader\.load/);
  assert.match(configuredLoader, /createResilientSteamInventoryFetch\(runtimeEnv\(\)\.STEAMAPIS_API_KEY\)/);
  assert.match(configuredLoader, /createSteamInventoryLoader/);
});

test("legacy Steam IDs remain migration data and cannot authorize application sessions", async () => {
  const authSource = await readFile("lib/server/auth.ts", "utf8");
  const sessionProjection = authSource.slice(
    authSource.indexOf("export async function getSessionUser"),
    authSource.indexOf("export async function requireUser"),
  );
  assert.doesNotMatch(sessionProjection, /users\.steamId|legacySteamId/);
  assert.match(sessionProjection, /steamId: steamLinks\.steamId/);
});

test("administrator user deletion is origin-protected, forbids self-deletion, and clears owned records", async () => {
  const adminUsersRoute = await readFile("app/api/admin/users/route.ts", "utf8");
  const deleteHandler = adminUsersRoute.slice(adminUsersRoute.indexOf("export async function DELETE"));
  assert.match(deleteHandler, /sameOrigin\(request\)/);
  assert.match(deleteHandler, /const admin = await requireAdmin\(request\)/);
  assert.match(deleteHandler, /id === admin\.id/);
  assert.match(deleteHandler, /delete\(tradeRequests\)/);
  assert.match(deleteHandler, /delete\(deals\)/);
  assert.match(deleteHandler, /createdBy: admin\.id/);
  assert.match(deleteHandler, /delete\(loginEvents\)/);
  assert.match(deleteHandler, /delete\(users\)/);
});

test("user payout profiles are migrated as structured safe references", async () => {
  const migration = await readFile("drizzle-postgres/0001_panoramic_the_anarchist.sql", "utf8");
  assert.match(migration, /CREATE TABLE "user_payment_profiles"/);
  assert.match(migration, /"recipient_name" text NOT NULL/);
  assert.match(migration, /"kaspi_phone" text/);
  assert.match(migration, /"card_last4" text/);
  assert.match(migration, /user_payment_profiles_reference_check/);
  assert.doesNotMatch(migration, /card_number|cvv|cvc|pin/);
});

test("full card numbers use encrypted storage and audited reveal access", async () => {
  const migration = await readFile("drizzle-postgres/0002_many_screwball.sql", "utf8");
  const revealRoute = await readFile("app/api/admin/payment-profile/reveal/route.ts", "utf8");
  assert.match(migration, /"card_pan_encrypted" text/);
  assert.match(migration, /CREATE TABLE "payment_profile_access_events"/);
  assert.doesNotMatch(migration, /cvv|cvc|pin|expiry/);
  assert.match(revealRoute, /requireAdmin\(request\)/);
  assert.match(revealRoute, /sameOrigin\(request\)/);
  assert.match(revealRoute, /paymentProfileAccessEvents/);
  assert.match(revealRoute, /"cache-control": "private, no-store, max-age=0"/);
});
