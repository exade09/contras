import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogFacets,
  createCatalogLoader,
  fetchJsonWithRetry,
  normalizeCatalogPayloads,
  queryCatalog,
  trustedCatalogImage,
} from "../lib/server/skins.ts";

const image = "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/default_generated/weapon_deagle_hy_ddpat_urb_light_png.png";

function skin(id, weapon, category, wear = "Factory New", extras = {}) {
  const name = `${weapon} | Test Finish`;
  return {
    id,
    name,
    market_hash_name: `${name} (${wear})`,
    weapon: { id: `weapon-${id}`, name: weapon },
    category: { id: `category-${category}`, name: category },
    wear: { id: `wear-${wear}`, name: wear },
    rarity: { id: "rarity-test", name: "Test Grade", color: "#4b69ff" },
    collections: [{ id: "collection-test", name: "The Test Collection" }],
    image,
    ...extras,
  };
}

function item(id, name, extras = {}) {
  return {
    id,
    name,
    market_hash_name: name,
    rarity: { id: "rarity-test", name: "High Grade", color: "#4b69ff" },
    image,
    ...extras,
  };
}

const weaponVariants = [
  skin("skin-pistol-0", "Desert Eagle", "Pistols"),
  skin("skin-rifle-0", "AK-47", "Rifles"),
  skin("skin-smg-0", "MP9", "SMGs"),
  skin("skin-shotgun-0", "XM1014", "Heavy"),
  skin("skin-machine-gun-0", "Negev", "Heavy"),
  skin("skin-sniper-0", "AWP", "Rifles"),
  skin("skin-knife-0", "Karambit", "Knives"),
  skin("skin-glove-0", "Sport Gloves", "Gloves"),
];

const allItems = {
  "agent-test": item("agent-test", "Test Agent"),
  "sticker-test": item("sticker-test", "Sticker | Test", { type: "Team" }),
  "crate-test": item("crate-test", "Test Case", { type: "Case" }),
  "patch-test": item("patch-test", "Patch | Test"),
  "graffiti-test": item("graffiti-test", "Sealed Graffiti | Test"),
  "keychain-test": item("keychain-test", "Charm | Test"),
  "music_kit-test": item("music_kit-test", "Music Kit | Test"),
  "key-test": item("key-test", "Test Case Key"),
  "tool-test": item("tool-test", "Test Tool"),
  "collectible-test": item("collectible-test", "Test Coin", { market_hash_name: null }),
  "base_weapon-test": item("base_weapon-test", "Default Test Weapon", { market_hash_name: null }),
};

test("normalizes every required catalog category and keeps official images", () => {
  const catalog = normalizeCatalogPayloads(allItems, weaponVariants);
  const facets = buildCatalogFacets(catalog);

  assert.deepEqual(
    facets.weaponCategories,
    ["Gloves", "Heavy", "Knives", "Machine Guns", "Pistols", "Rifles", "Shotguns", "SMGs", "Sniper Rifles"],
  );
  for (const type of [
    "Weapon Skins", "Agents", "Stickers", "Crates and Cases", "Patches", "Graffiti",
    "Charms", "Music Kits", "Keys and Tools", "Collectibles", "Other",
  ]) {
    assert.ok(facets.itemTypes.includes(type), `missing ${type}`);
  }
  assert.equal(catalog.find((entry) => entry.id === "skin-pistol-0")?.image, image);
  assert.equal(trustedCatalogImage("http://example.com/item.png"), null);
  assert.equal(trustedCatalogImage("https://example.com/item.png"), null);
});

test("deduplicates by stable id and exact market hash name without merging wear variants", () => {
  const duplicate = item("sticker-copy", "Sticker | Test", { description: "richer duplicate" });
  const minimalWear = skin("skin-pistol-1", "Desert Eagle", "Pistols", "Minimal Wear");
  const catalog = normalizeCatalogPayloads({ ...allItems, "sticker-copy": duplicate }, [...weaponVariants, minimalWear]);

  assert.equal(catalog.filter((entry) => entry.marketHashName === "Sticker | Test").length, 1);
  assert.equal(catalog.filter((entry) => entry.name === "Desert Eagle | Test Finish").length, 2);
  assert.deepEqual(
    catalog.filter((entry) => entry.name === "Desert Eagle | Test Finish").map((entry) => entry.wear).sort(),
    ["Factory New", "Minimal Wear"],
  );

  const caseVariant = item("sticker-case-variant", "Sticker | test");
  const exactCatalog = normalizeCatalogPayloads({ ...allItems, "sticker-case-variant": caseVariant }, weaponVariants);
  assert.equal(exactCatalog.filter((entry) => entry.marketHashName?.toLowerCase() === "sticker | test").length, 2);
});

test("searches metadata fields and applies category, rarity, weapon, and wear filters", () => {
  const catalog = normalizeCatalogPayloads(allItems, weaponVariants);

  assert.equal(queryCatalog(catalog, { query: "test collection" }).total, weaponVariants.length);
  assert.equal(queryCatalog(catalog, { query: "sealed graffiti" }).items[0].itemType, "Graffiti");
  assert.equal(queryCatalog(catalog, { itemType: "Agents" }).total, 1);
  assert.equal(queryCatalog(catalog, { weaponCategory: "Sniper Rifles" }).items[0].weapon, "AWP");
  assert.equal(queryCatalog(catalog, { weaponCategory: "Heavy" }).total, 2);
  assert.equal(queryCatalog(catalog, { weapon: "MP9", rarity: "Test Grade", wear: "Factory New" }).total, 1);
  assert.equal(queryCatalog(catalog, { query: "does-not-exist" }).total, 0);
});

test("paginates first, middle, partial last, out-of-range, and empty result sets", () => {
  const catalog = normalizeCatalogPayloads(allItems, weaponVariants);
  const first = queryCatalog(catalog, { page: 1, pageSize: 5 });
  const middle = queryCatalog(catalog, { page: 2, pageSize: 5 });
  const last = queryCatalog(catalog, { page: 99, pageSize: 5 });
  const empty = queryCatalog(catalog, { query: "no match", pageSize: 5 });

  assert.deepEqual(first.pagination, {
    page: 1, pageSize: 5, totalPages: 4, total: 19,
    rangeStart: 1, rangeEnd: 5, hasPrevious: false, hasNext: true,
  });
  assert.equal(middle.pagination.page, 2);
  assert.equal(middle.items.length, 5);
  assert.equal(last.pagination.page, 4);
  assert.equal(last.items.length, 4);
  assert.deepEqual(empty.pagination, {
    page: 1, pageSize: 5, totalPages: 1, total: 0,
    rangeStart: 0, rangeEnd: 0, hasPrevious: false, hasNext: false,
  });
});

test("retries HTTP 429 and rejects deterministic timeouts and invalid JSON", async () => {
  let rateLimitCalls = 0;
  const rateLimitedFetch = async () => {
    rateLimitCalls += 1;
    return rateLimitCalls === 1
      ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
      : Response.json({ ok: true });
  };
  const result = await fetchJsonWithRetry("https://example.test/catalog", {
    fetchImpl: rateLimitedFetch,
    retryDelaysMs: [0],
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(rateLimitCalls, 2);

  const timeoutFetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await assert.rejects(
    fetchJsonWithRetry("https://example.test/catalog", { fetchImpl: timeoutFetch, timeoutMs: 5, retryDelaysMs: [] }),
    (error) => error.code === "timeout" && error.status === 504,
  );
  await assert.rejects(
    fetchJsonWithRetry("https://example.test/catalog", {
      fetchImpl: async () => new Response("not-json", { status: 200 }),
      retryDelaysMs: [],
    }),
    (error) => error.code === "invalid_json",
  );
});

test("coalesces upstream loads, serves last-known-good data, and falls back when cold", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  let calls = 0;
  let fail = false;
  const fetchImpl = async (url) => {
    calls += 1;
    if (fail) throw new Error("offline");
    return Response.json(url.endsWith("skins_not_grouped.json") ? weaponVariants : allItems);
  };
  const loader = createCatalogLoader({
    baseUrl: "https://example.test/api/en",
    fetchImpl,
    retryDelaysMs: [],
    ttlMs: 10,
    now: () => now,
  });
  const [first, coalesced] = await Promise.all([loader(), loader()]);
  assert.equal(calls, 2);
  assert.strictEqual(first, coalesced);
  assert.equal(first.source, "upstream");

  now += 11;
  fail = true;
  const stale = await loader();
  assert.equal(stale.source, "last-known-good");
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.items, first.items);

  const coldLoader = createCatalogLoader({
    baseUrl: "https://example.test/api/en",
    fetchImpl: async () => { throw new Error("offline"); },
    retryDelaysMs: [],
  });
  const fallback = await coldLoader();
  assert.equal(fallback.source, "bundled-fallback");
  assert.equal(fallback.stale, true);
  assert.ok(fallback.items.length > 0);
});
