import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSteamInventoryUrl,
  createResilientSteamInventoryFetch,
  createSteamInventoryLoader,
  steamCdnImageUrl,
} from "../lib/server/steam-inventory.ts";

const STEAM_ID = "76561198000000000";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    ...init,
  });
}

test("inventory URL always targets CS2 context 2 in English", () => {
  const url = buildSteamInventoryUrl(STEAM_ID, { pageSize: 2000, startAssetId: "42" });
  assert.equal(url.origin + url.pathname, `https://steamcommunity.com/inventory/${STEAM_ID}/730/2`);
  assert.equal(url.searchParams.get("l"), "english");
  assert.equal(url.searchParams.get("count"), "2000");
  assert.equal(url.searchParams.get("start_assetid"), "42");
});

test("Steam 429 switches once to the server-only SteamApis inventory fallback", async () => {
  const requested = [];
  const fallbackFetch = createResilientSteamInventoryFetch("fallback-secret", async (input, init) => {
    const url = new URL(input);
    requested.push(url);
    if (url.origin === "https://steamcommunity.com") {
      return new Response("rate limited", { status: 429 });
    }
    assert.equal(url.origin, "https://api.steamapis.com");
    assert.equal(url.pathname, `/v2/steam/users/${STEAM_ID}/inventory/730/2`);
    assert.equal(new Headers(init?.headers).get("x-api-key"), "fallback-secret");
    assert.equal(url.searchParams.has("key"), false);
    return jsonResponse({
      success: true,
      result: {
        assets: [{ appid: 730, contextid: "2", assetid: "101", classid: "201", instanceid: "0", amount: "1" }],
        descriptions: [{
          appid: 730, classid: "201", instanceid: "0", name: "Fallback item",
          market_hash_name: "Fallback item", type: "Base Grade Container",
          tradable: 1, marketable: 1,
        }],
      },
    });
  });
  const loader = createSteamInventoryLoader({ fetchImpl: fallbackFetch, maxRetries: 2 });

  const result = await loader.load(STEAM_ID);

  assert.equal(result.state, "success");
  assert.equal(result.items[0].assetId, "101");
  assert.equal(result.items[0].name, "Fallback item");
  assert.equal(requested.length, 2);
});

test("Steam 429 is not retried repeatedly from the same server IP", async () => {
  let calls = 0;
  const loader = createSteamInventoryLoader({
    maxRetries: 5,
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });

  const result = await loader.load(STEAM_ID);

  assert.equal(result.state, "rate_limited");
  assert.equal(calls, 1);
});

test("inventory fallback reports missing and rejected server configuration safely", async (t) => {
  await t.test("missing Production variable", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: createResilientSteamInventoryFetch(undefined, async () =>
        new Response("rate limited", { status: 429 })),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.fallbackIssue, "not_configured");
    assert.match(result.error?.message || "", /not available in the Production deployment/);
  });

  await t.test("provider rejects key", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: createResilientSteamInventoryFetch("invalid-key", async (input) =>
        new URL(input).origin === "https://steamcommunity.com"
          ? new Response("rate limited", { status: 429 })
          : new Response("forbidden", { status: 403 })),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.fallbackIssue, "key_rejected");
    assert.match(result.error?.message || "", /rejected STEAMAPIS_API_KEY/);
  });

  await t.test("provider reports quota in a successful HTTP envelope", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: createResilientSteamInventoryFetch("configured-key", async (input) =>
        new URL(input).origin === "https://steamcommunity.com"
          ? new Response("rate limited", { status: 429 })
          : jsonResponse({
              success: false,
              error: { name: "BadRequestError", message: "INSUFFICIENT_BALANCE" },
            })),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.fallbackIssue, "account_or_quota");
    assert.match(result.error?.message || "", /no available request quota/);
  });
});

test("multi-page assets merge with classid+instanceid descriptions and catalog metadata", async () => {
  const requested = [];
  const loader = createSteamInventoryLoader({
    maxRetries: 0,
    fetchImpl: async (input) => {
      const url = new URL(input);
      requested.push(url);
      if (!url.searchParams.has("start_assetid")) {
        return jsonResponse({
          success: 1,
          total_inventory_count: 2,
          more_items: 1,
          last_assetid: "100",
          assets: [{ assetid: "100", classid: "10", instanceid: "0", amount: "1" }],
          descriptions: [{
            classid: "10",
            instanceid: "0",
            market_hash_name: "AK-47 | Redline (Field-Tested)",
            name: "AK-47 | Redline",
            type: "Rifle",
            icon_url: "safe_icon_1",
            tradable: 1,
            marketable: 1,
            actions: [{
              name: "Inspect in Game",
              link: "steam://rungame/730/0/+csgo_econ_action_preview%20S%owner_steamid%A%assetid%D1",
            }],
          }],
        });
      }
      assert.equal(url.searchParams.get("start_assetid"), "100");
      return jsonResponse({
        success: true,
        total_inventory_count: 2,
        more_items: false,
        assets: [{ assetid: "200", classid: "20", instanceid: "1", amount: "2" }],
        descriptions: [{
          classid: "20",
          instanceid: "1",
          market_hash_name: "Sticker | Test",
          icon_url_large: "safe_icon_2",
          tradable: 0,
          marketable: 1,
        }],
      });
    },
  });
  const catalog = new Map([["AK-47 | Redline (Field-Tested)", {
    id: "catalog-redline",
    weapon: "AK-47",
    rarity: "Classified",
  }]]);
  const result = await loader.load(STEAM_ID, { catalogIndex: catalog });
  assert.equal(result.state, "success");
  assert.equal(result.pagesLoaded, 2);
  assert.equal(result.items.length, 2);
  assert.equal(requested.length, 2);
  assert.deepEqual(
    {
      assetId: result.items[0].assetId,
      classId: result.items[0].classId,
      instanceId: result.items[0].instanceId,
      marketHashName: result.items[0].marketHashName,
      tradable: result.items[0].tradable,
      catalogId: result.items[0].catalog?.id,
    },
    {
      assetId: "100",
      classId: "10",
      instanceId: "0",
      marketHashName: "AK-47 | Redline (Field-Tested)",
      tradable: true,
      catalogId: "catalog-redline",
    },
  );
  assert.match(result.items[0].actions[0].link, /S76561198000000000A100D1/);
  assert.equal(result.items[1].quantity, 2);
  assert.equal(result.items[1].marketable, true);
  assert.equal(result.items[1].iconLargeUrl, steamCdnImageUrl("safe_icon_2"));
});

test("private, empty, rate-limit, and malformed inventories have explicit sanitized states", async (t) => {
  await t.test("private", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: async () => new Response("private details", { status: 403 }),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "private");
    assert.equal(result.error.message, "Steam inventory is private.");
    assert.doesNotMatch(result.error.message, /details/);
  });
  await t.test("empty", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: async () => jsonResponse({ success: 1, assets: [], descriptions: [] }),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "empty");
    assert.deepEqual(result.items, []);
  });
  await t.test("rate limited", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: async () => new Response("slow down", {
        status: 429,
        headers: { "retry-after": "3" },
      }),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "rate_limited");
    assert.equal(result.retryAfterSeconds, 3);
  });
  await t.test("malformed", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      fetchImpl: async () => jsonResponse({ success: 1, assets: { assetid: "1" } }),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "malformed");
  });
});

test("timeouts are bounded and 5xx responses retry with injected backoff", async (t) => {
  await t.test("timeout", async () => {
    const loader = createSteamInventoryLoader({
      maxRetries: 0,
      timeoutMs: 5,
      fetchImpl: async () => new Promise(() => {}),
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "timeout");
  });
  await t.test("5xx retry", async () => {
    let calls = 0;
    const delays = [];
    const loader = createSteamInventoryLoader({
      maxRetries: 1,
      retryBaseMs: 7,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? new Response("unavailable", { status: 503 })
          : jsonResponse({ success: 1, assets: [], descriptions: [] });
      },
    });
    const result = await loader.load(STEAM_ID);
    assert.equal(result.state, "empty");
    assert.equal(calls, 2);
    assert.deepEqual(delays, [7]);
  });
});

test("simultaneous loads coalesce and a later load is a cache hit", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = createSteamInventoryLoader({
    maxRetries: 0,
    cacheTtlMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return jsonResponse({ success: 1, assets: [], descriptions: [] });
    },
  });
  const first = loader.load(STEAM_ID);
  const second = loader.load(STEAM_ID);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(firstResult.cache, "miss");
  assert.equal(secondResult.cache, "coalesced");
  const thirdResult = await loader.load(STEAM_ID);
  assert.equal(thirdResult.cache, "hit");
  assert.equal(calls, 1);
});
