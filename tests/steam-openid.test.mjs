import assert from "node:assert/strict";
import test from "node:test";

import {
  STEAM_OPENID_ENDPOINT,
  STEAM_OPENID_NAMESPACE,
  buildSteamOpenIdAuthenticationUrl,
  buildSteamOpenIdReturnTo,
  canonicalAppOrigin,
  checkSteamOpenIdAuthentication,
  isValidOpenIdState,
  validateOpenIdResponseNonce,
  validateSteamOpenIdCallback,
} from "../lib/server/steam-openid.ts";

const ORIGIN = "https://contras.example";
const STATE = "state_abcdefghijklmnopqrstuvwxyz_1234567890";
const STEAM_ID = "76561198000000000";
const NOW = new Date("2026-07-18T12:05:00Z");

function callbackUrl(overrides = {}) {
  const claimedId = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
  const params = new URLSearchParams({
    state: STATE,
    "openid.ns": STEAM_OPENID_NAMESPACE,
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.return_to": buildSteamOpenIdReturnTo({ configuredUrl: ORIGIN, state: STATE }),
    "openid.response_nonce": "2026-07-18T12:04:00Znonce-value",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "fixture-signature",
    "openid.assoc_handle": "fixture-association",
    ...overrides,
  });
  return `${ORIGIN}/api/steam/callback?${params}`;
}

test("canonical origin and authentication URL are strict and official", () => {
  assert.equal(canonicalAppOrigin(`${ORIGIN}/`), ORIGIN);
  assert.throws(() => canonicalAppOrigin("http://contras.example"));
  assert.throws(() => canonicalAppOrigin(`${ORIGIN}/nested`));
  assert.equal(canonicalAppOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(isValidOpenIdState(STATE), true);
  assert.equal(isValidOpenIdState("short"), false);

  const redirect = buildSteamOpenIdAuthenticationUrl({ configuredUrl: ORIGIN, state: STATE });
  assert.equal(redirect.origin + redirect.pathname, STEAM_OPENID_ENDPOINT);
  assert.equal(redirect.searchParams.get("openid.mode"), "checkid_setup");
  assert.equal(redirect.searchParams.get("openid.realm"), `${ORIGIN}/`);
  assert.equal(
    redirect.searchParams.get("openid.return_to"),
    `${ORIGIN}/api/steam/callback?state=${STATE}`,
  );
});

test("valid callback returns a typed SteamID64 assertion", () => {
  const result = validateSteamOpenIdCallback(callbackUrl(), {
    configuredUrl: ORIGIN,
    expectedState: STATE,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.assertion.steamId64, STEAM_ID);
  assert.equal(result.ok && result.assertion.responseNonce, "2026-07-18T12:04:00Znonce-value");
});

test("forged callback variants are rejected before contacting Steam", async (t) => {
  await t.test("wrong return_to", () => {
    const result = validateSteamOpenIdCallback(callbackUrl({
      "openid.return_to": "https://attacker.example/callback",
    }), { configuredUrl: ORIGIN, expectedState: STATE, now: NOW });
    assert.deepEqual(result, { ok: false, error: "invalid_return_to" });
  });
  await t.test("insecure claimed identity", () => {
    const insecure = `http://steamcommunity.com/openid/id/${STEAM_ID}`;
    const result = validateSteamOpenIdCallback(callbackUrl({
      "openid.claimed_id": insecure,
      "openid.identity": insecure,
    }), { configuredUrl: ORIGIN, expectedState: STATE, now: NOW });
    assert.deepEqual(result, { ok: false, error: "invalid_claimed_id" });
  });
  await t.test("missing signed identity", () => {
    const result = validateSteamOpenIdCallback(callbackUrl({
      "openid.signed": "op_endpoint,return_to,response_nonce",
    }), { configuredUrl: ORIGIN, expectedState: STATE, now: NOW });
    assert.deepEqual(result, { ok: false, error: "incomplete_signature" });
  });
  await t.test("wrong state", () => {
    const result = validateSteamOpenIdCallback(callbackUrl(), {
      configuredUrl: ORIGIN,
      expectedState: "different_state_abcdefghijklmnopqrstuvwxyz_1234",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, error: "invalid_state" });
  });
});

test("response nonce helper enforces format, freshness, and clock skew", () => {
  assert.equal(validateOpenIdResponseNonce(
    "2026-07-18T12:04:00Zfixture",
    { now: NOW },
  ).valid, true);
  assert.deepEqual(validateOpenIdResponseNonce(
    "2026-07-18T11:00:00Zexpired",
    { now: NOW },
  ), { valid: false, reason: "expired" });
  assert.deepEqual(validateOpenIdResponseNonce("not-a-nonce", { now: NOW }), {
    valid: false,
    reason: "malformed",
  });
});

test("check_authentication posts signed fields to Steam and accepts only is_valid:true", async () => {
  const validated = validateSteamOpenIdCallback(callbackUrl(), {
    configuredUrl: ORIGIN,
    expectedState: STATE,
    now: NOW,
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  let requestBody;
  const result = await checkSteamOpenIdAuthentication(validated.assertion, {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), STEAM_OPENID_ENDPOINT);
      assert.equal(init.method, "POST");
      requestBody = new URLSearchParams(init.body);
      return new Response(`ns:${STEAM_OPENID_NAMESPACE}\nis_valid:true\n`);
    },
  });
  assert.deepEqual(result, { valid: true });
  assert.equal(requestBody.get("openid.mode"), "check_authentication");
  assert.equal(requestBody.get("openid.claimed_id"), validated.assertion.claimedId);
});

test("check_authentication is bounded when the upstream fetch hangs", async () => {
  const result = await checkSteamOpenIdAuthentication(
    { params: new URLSearchParams({ "openid.mode": "id_res" }) },
    {
      fetchImpl: async () => new Promise(() => {}),
      timeoutMs: 5,
    },
  );
  assert.deepEqual(result, { valid: false, reason: "timeout" });
});
