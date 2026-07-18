import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogPriceCache,
  MockCatalogPriceProvider,
  attachCatalogPrices,
  createProductionCatalogPriceProvider,
  decimalToMinorUnits,
  normalizePriceRecord,
  validateCurrency,
} from "../lib/server/catalog-prices.ts";
import { normalizeCatalogPayloads, queryCatalog } from "../lib/server/skins.ts";

const image = "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/default_generated/weapon_deagle_hy_ddpat_urb_light_png.png";
const variants = [
  {
    id: "skin-test-0",
    name: "AK-47 | Test",
    market_hash_name: "AK-47 | Test (Factory New)",
    weapon: { name: "AK-47" },
    category: { name: "Rifles" },
    wear: { name: "Factory New" },
    rarity: { id: "rare", name: "Classified", color: "#d32ce6" },
    image,
  },
  {
    id: "skin-test-1",
    name: "AK-47 | Test",
    market_hash_name: "AK-47 | Test (Field-Tested)",
    weapon: { name: "AK-47" },
    category: { name: "Rifles" },
    wear: { name: "Field-Tested" },
    rarity: { id: "rare", name: "Classified", color: "#d32ce6" },
    image,
  },
  {
    id: "skin-test-2",
    name: "StatTrak™ AK-47 | Test",
    market_hash_name: "StatTrak™ AK-47 | Test (Factory New)",
    weapon: { name: "AK-47" },
    category: { name: "Rifles" },
    wear: { name: "Factory New" },
    stattrak: true,
    rarity: { id: "rare", name: "Classified", color: "#d32ce6" },
    image,
  },
];

test("normalizes integer minor units and validates currencies without floating-point conversion", () => {
  assert.equal(decimalToMinorUnits("124.50", "USD"), 12_450);
  assert.equal(decimalToMinorUnits("124", "JPY"), 124);
  assert.equal(decimalToMinorUnits("1.234", "BHD"), 1_234);
  assert.equal(decimalToMinorUnits("1.234", "USD"), null);
  assert.equal(decimalToMinorUnits("0", "USD"), null);
  assert.equal(validateCurrency("usd"), "USD");
  assert.equal(validateCurrency("ZZZZ"), null);
  assert.equal(validateCurrency("ZZZ"), null);
  assert.deepEqual(normalizePriceRecord({
    marketHashName: "AK-47 | Test (Factory New)",
    amountMinor: 12_450,
    currency: "USD",
    updatedAt: "2026-01-01T00:00:00Z",
  }), {
    marketHashName: "AK-47 | Test (Factory New)",
    amountMinor: 12_450,
    currency: "USD",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(normalizePriceRecord({ marketHashName: "AK-47", amountMinor: 12.5, currency: "USD" }), null);
  assert.equal(normalizePriceRecord({ marketHashName: "AK-47", amountMinor: 0, currency: "USD" }), null);
});

test("matches exact market hash variants, keeps missing prices unavailable, and marks old prices stale", async () => {
  const catalog = normalizeCatalogPayloads({}, variants);
  const provider = new MockCatalogPriceProvider([
    {
      marketHashName: "AK-47 | Test (Factory New)",
      amountMinor: 12_450,
      currency: "USD",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      marketHashName: "ak-47 | test (field-tested)",
      amountMinor: 5_000,
      currency: "USD",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      marketHashName: "StatTrak™ AK-47 | Test (Factory New)",
      amountMinor: 30_000,
      currency: "USD",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ]);
  const cache = new CatalogPriceCache({ ttlMs: 10_000 });
  const batch = await cache.get(provider, catalog.map((item) => item.marketHashName), "USD");
  const priced = attachCatalogPrices(catalog, batch, {
    now: Date.parse("2026-01-01T00:10:00Z"),
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(priced.find((item) => item.marketHashName?.includes("Factory New") && !item.stattrak)?.price.amountMinor, 12_450);
  assert.equal(priced.find((item) => item.marketHashName?.includes("Field-Tested"))?.price.status, "unavailable");
  assert.equal(priced.find((item) => item.stattrak)?.price.status, "stale");
  assert.equal(batch.status, "partial");
});

test("supports multiple currencies and price sorting while leaving unpriced items visible", async () => {
  const catalog = normalizeCatalogPayloads({}, variants);
  const records = [
    { marketHashName: variants[0].market_hash_name, amountMinor: 200, currency: "USD", updatedAt: "2026-01-01T00:00:00Z" },
    { marketHashName: variants[1].market_hash_name, amountMinor: 100, currency: "USD", updatedAt: "2026-01-01T00:00:00Z" },
    { marketHashName: variants[0].market_hash_name, amountMinor: 180, currency: "EUR", updatedAt: "2026-01-01T00:00:00Z" },
  ];
  const provider = new MockCatalogPriceProvider(records);
  const cache = new CatalogPriceCache({ ttlMs: 10_000 });
  const usd = attachCatalogPrices(catalog, await cache.get(provider, catalog.map((item) => item.marketHashName), "USD"), {
    now: Date.parse("2026-01-01T00:05:00Z"), staleAfterMs: 60 * 60 * 1000,
  });
  const euro = attachCatalogPrices(catalog, await cache.get(provider, catalog.map((item) => item.marketHashName), "EUR"), {
    now: Date.parse("2026-01-01T00:05:00Z"), staleAfterMs: 60 * 60 * 1000,
  });

  const ascending = queryCatalog(usd, { sort: "price_asc", pageSize: 10 });
  const descending = queryCatalog(usd, { sort: "price_desc", pageSize: 10 });
  assert.deepEqual(ascending.items.map((item) => item.price.amountMinor), [100, 200, null]);
  assert.deepEqual(descending.items.map((item) => item.price.amountMinor), [200, 100, null]);
  assert.equal(euro.find((item) => item.marketHashName === variants[0].market_hash_name)?.price.currency, "EUR");
  assert.equal(queryCatalog(usd, { onlyWithPrices: true }).total, 2);
  assert.equal(queryCatalog(usd, { minPriceMinor: 150, maxPriceMinor: 250 }).total, 1);
});

test("price cache provides hits, request coalescing, and stale-while-revalidate", async () => {
  let now = 1_000;
  let resolveRequest;
  let calls = 0;
  const provider = {
    id: "delayed-mock",
    configured: true,
    async getPrices(names, currency) {
      calls += 1;
      await new Promise((resolve) => { resolveRequest = resolve; });
      return {
        source: "Skinport",
        status: "available",
        currency,
        prices: [{ marketHashName: names[0], amountMinor: 100, currency, updatedAt: "2026-01-01T00:00:00Z" }],
        requestedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:00Z",
        configured: true,
      };
    },
  };
  const cache = new CatalogPriceCache({ ttlMs: 10, staleWhileRevalidateMs: 100, now: () => now });
  const firstPromise = cache.get(provider, ["AK-47 | Test"], "USD");
  const coalescedPromise = cache.get(provider, ["AK-47 | Test"], "USD");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveRequest();
  const [first, coalesced] = await Promise.all([firstPromise, coalescedPromise]);
  assert.equal(first.cache, "miss");
  assert.equal(coalesced.cache, "miss");
  assert.equal((await cache.get(provider, ["AK-47 | Test"], "USD")).cache, "hit");

  now += 11;
  const stale = await cache.get(provider, ["AK-47 | Test"], "USD");
  assert.equal(stale.cache, "stale");
  assert.equal(stale.cacheStale, true);
  resolveRequest();
});

test("production provider uses the documented Skinport endpoint and exact market variants", async () => {
  let request;
  const provider = createProductionCatalogPriceProvider({
    now: () => Date.parse("2026-07-18T12:00:00Z"),
    fetchImpl: async (input, init) => {
      request = { url: input.toString(), init };
      return Response.json([
        {
          market_hash_name: "AK-47 | Test (Factory New)",
          currency: "USD",
          suggested_price: 12.5,
          min_price: 11.25,
          updated_at: 1_752_840_000,
        },
        {
          market_hash_name: "AK-47 | Test (Field-Tested)",
          currency: "USD",
          suggested_price: 7.75,
          min_price: null,
          updated_at: 1_752_840_000,
        },
        {
          market_hash_name: "Unrequested item",
          currency: "USD",
          suggested_price: 99,
          min_price: 98,
          updated_at: 1_752_840_000,
        },
      ]);
    },
  });
  const result = await provider.getPrices([
    "AK-47 | Test (Factory New)",
    "AK-47 | Test (Field-Tested)",
  ], "USD");

  assert.equal(result.status, "available");
  assert.equal(result.prices.length, 2);
  assert.equal(result.prices[0].amountMinor, 1_125);
  assert.equal(result.prices[1].amountMinor, 775);
  assert.match(request.url, /^https:\/\/api\.skinport\.com\/v1\/items\?/);
  assert.match(request.url, /app_id=730/);
  assert.match(request.url, /currency=USD/);
  assert.equal(request.init.headers["accept-encoding"], "br");
});

test("provider timeouts and rate limits degrade to a temporary unavailable batch", async () => {
  for (const [id, message] of [["timeout-provider", "request timed out"], ["rate-limit-provider", "HTTP 429"]]) {
    const provider = {
      id,
      configured: true,
      async getPrices() { throw new Error(message); },
    };
    const cache = new CatalogPriceCache({ ttlMs: 10 });
    const result = await cache.get(provider, ["AK-47 | Test"], "USD");
    assert.equal(result.status, "temporarily_unavailable");
    assert.equal(result.prices.length, 0);
    assert.equal(result.cache, "miss");
  }
});
