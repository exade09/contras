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
  assert.match(tradeRoute, /ownershipSource: "Steam Community Inventory"/);
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
