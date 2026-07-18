import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVerifiedSteamProfile,
  resolveSteamAuthAction,
  steamBrowserBinding,
  steamNonceCookie,
} from "../lib/server/steam-auth-flow.ts";

function memoryStore(seed = {}) {
  const accounts = new Map(Object.entries(seed.accounts || {}));
  const links = new Map(Object.entries(seed.links || {}));
  const touches = [];
  return {
    accounts,
    links,
    touches,
    store: {
      async findLinkedUserId(steamId64) {
        for (const [userId, profile] of links) if (profile.steamId64 === steamId64) return userId;
        return null;
      },
      async findAccount(userId) { return accounts.get(userId) || null; },
      async loginExists(login) {
        return Array.from(accounts.values()).some((account) => account.login === login);
      },
      async createAccount(record) { accounts.set(record.id, { ...record }); },
      async upsertVerifiedLink(userId, profile, now) { links.set(userId, { ...profile, verifiedAt: now }); },
      async touchLogin(userId, now) {
        touches.push({ userId, now });
        const account = accounts.get(userId);
        if (account) accounts.set(userId, { ...account, lastLoginAt: now, updatedAt: now });
      },
    },
  };
}

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("Steam auth action covers registration, repeat login, linking, and conflict", () => {
  assert.equal(resolveSteamAuthAction({
    intent: "login",
    stateUserId: null,
    currentUserId: null,
    linkedUserId: null,
  }), "register");
  assert.equal(resolveSteamAuthAction({
    intent: "login",
    stateUserId: null,
    currentUserId: null,
    linkedUserId: "existing-user",
  }), "login_existing");
  assert.equal(resolveSteamAuthAction({
    intent: "link",
    stateUserId: "current-user",
    currentUserId: "current-user",
    linkedUserId: null,
  }), "link_new");
  assert.equal(resolveSteamAuthAction({
    intent: "link",
    stateUserId: "current-user",
    currentUserId: "current-user",
    linkedUserId: "current-user",
  }), "link_existing");
  assert.equal(resolveSteamAuthAction({
    intent: "link",
    stateUserId: "current-user",
    currentUserId: "current-user",
    linkedUserId: "different-user",
  }), "conflict");
  assert.equal(resolveSteamAuthAction({
    intent: "link",
    stateUserId: "current-user",
    currentUserId: null,
    linkedUserId: null,
  }), "invalid_link_session");
});

test("browser nonce cookie is HttpOnly, SameSite and hash-bound", async () => {
  const nonce = "browser_nonce_abcdefghijklmnopqrstuvwxyz_123456";
  const request = new Request("https://contras.example/api/steam/callback", {
    headers: { cookie: `contras_steam_nonce=${nonce}` },
  });
  const cookie = steamNonceCookie(request, nonce);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/steam/);
  assert.match(cookie, /Secure/);
  assert.equal(await steamBrowserBinding(request, await sha256(nonce)), true);
  assert.equal(await steamBrowserBinding(request, await sha256("another nonce")), false);
});

test("verified Steam workflow registers, repeats login, links local accounts, and rejects collisions", async () => {
  const profile = {
    steamId64: "76561198000000000",
    displayName: "Fixture Player",
    avatarUrl: null,
    profileUrl: "https://steamcommunity.com/profiles/76561198000000000",
  };
  const now = "2026-07-18T12:00:00.000Z";
  const registration = memoryStore();
  const first = await applyVerifiedSteamProfile({
    intent: "login", stateUserId: null, currentUserId: null, profile, now,
    idFactory: () => "new-user-id",
  }, registration.store);
  assert.deepEqual(first, { kind: "authenticated", userId: "new-user-id" });
  assert.equal(registration.accounts.get("new-user-id").role, "user");
  assert.equal(registration.accounts.get("new-user-id").login, "steam_76561198000000000");
  assert.equal(registration.links.get("new-user-id").steamId64, profile.steamId64);

  const repeat = await applyVerifiedSteamProfile({
    intent: "login", stateUserId: null, currentUserId: null, profile,
    now: "2026-07-18T12:05:00.000Z",
  }, registration.store);
  assert.deepEqual(repeat, { kind: "authenticated", userId: "new-user-id" });
  assert.equal(registration.touches.length, 1);

  const linking = memoryStore({
    accounts: { "local-user": { id: "local-user", login: "local", status: "active", role: "user" } },
  });
  const linked = await applyVerifiedSteamProfile({
    intent: "link", stateUserId: "local-user", currentUserId: "local-user", profile, now,
  }, linking.store);
  assert.deepEqual(linked, { kind: "authenticated", userId: "local-user" });
  assert.equal(linking.links.get("local-user").steamId64, profile.steamId64);

  const conflict = memoryStore({
    accounts: {
      "local-user": { id: "local-user", status: "active", role: "user" },
      "other-user": { id: "other-user", status: "active", role: "user" },
    },
    links: { "other-user": profile },
  });
  assert.deepEqual(await applyVerifiedSteamProfile({
    intent: "link", stateUserId: "local-user", currentUserId: "local-user", profile, now,
  }, conflict.store), { kind: "conflict" });
  assert.equal(conflict.links.has("local-user"), false);

  const blocked = memoryStore({
    accounts: { blocked: { id: "blocked", status: "blocked", role: "user" } },
    links: { blocked: profile },
  });
  assert.deepEqual(await applyVerifiedSteamProfile({
    intent: "login", stateUserId: null, currentUserId: null, profile, now,
  }, blocked.store), { kind: "blocked" });
});
