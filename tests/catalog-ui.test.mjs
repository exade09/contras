import assert from "node:assert/strict";
import test from "node:test";

import { catalogPageWindow, catalogPricePresentation, catalogPricingNotice, catalogSearchParams, updateCatalogFilter } from "../lib/catalog-ui.ts";

const filters = { q: "", itemType: "", weaponCategory: "", weapon: "", rarity: "", wear: "", sort: "default", onlyWithPrices: false, page: 8 };

test("catalog page navigation includes first, last, current neighbors, and ellipses", () => {
  assert.deepEqual(catalogPageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(catalogPageWindow(8, 20), [1, 2, "ellipsis", 7, 8, 9, "ellipsis", 19, 20]);
  assert.deepEqual(catalogPageWindow(20, 20), [1, 2, "ellipsis", 19, 20]);
  assert.deepEqual(catalogPageWindow(1, 0), []);
});

test("filter, search, sort, and price changes reset to page one", () => {
  assert.equal(updateCatalogFilter(filters, "q", "Doppler").page, 1);
  assert.equal(updateCatalogFilter(filters, "rarity", "Covert").page, 1);
  assert.equal(updateCatalogFilter(filters, "sort", "price_desc").page, 1);
  assert.equal(updateCatalogFilter(filters, "onlyWithPrices", true).page, 1);
});

test("page changes preserve active catalog filters in URL parameters", () => {
  const active = { ...filters, q: "AK-47", rarity: "Covert", onlyWithPrices: true, page: 4 };
  const next = updateCatalogFilter(active, "page", 5);
  const params = catalogSearchParams(next);
  assert.equal(next.page, 5);
  assert.equal(params.get("q"), "AK-47");
  assert.equal(params.get("rarity"), "Covert");
  assert.equal(params.get("onlyWithPrices"), "true");
  assert.equal(params.get("page"), "5");
});

test("catalog price presentation renders current, stale, missing, and temporary CS.MONEY states", () => {
  const now = Date.parse("2026-07-18T12:10:00Z");
  assert.deepEqual(catalogPricePresentation({
    status: "available", amountMinor: 12_450, currency: "USD",
    updatedAt: "2026-07-18T12:05:00Z", stale: false,
  }, now), {
    amountLabel: "$124.50", sourceLabel: "CS.MONEY price",
    updatedLabel: "Updated 5 minutes ago", available: true, stale: false,
  });
  assert.deepEqual(catalogPricePresentation({
    status: "stale", amountMinor: 8_920, currency: "EUR",
    updatedAt: "2026-07-17T12:10:00Z", stale: true,
  }, now), {
    amountLabel: "€89.20", sourceLabel: "CS.MONEY price",
    updatedLabel: "Updated 1 day ago · Stale", available: true, stale: true,
  });
  assert.equal(catalogPricePresentation({
    status: "unavailable", amountMinor: null, currency: null, updatedAt: null, stale: false,
  }, now).amountLabel, "Price unavailable");
  assert.equal(catalogPricePresentation({
    status: "temporarily_unavailable", amountMinor: null, currency: "USD", updatedAt: null, stale: false,
  }, now).amountLabel, "Price temporarily unavailable");
});

test("catalog pricing notices distinguish partial, temporary, unconfigured, and contract-blocked states", () => {
  assert.equal(catalogPricingNotice("available", true), null);
  assert.match(catalogPricingNotice("partial", true).title, /Some CS\.MONEY prices/);
  assert.match(catalogPricingNotice("temporarily_unavailable", true).title, /temporarily unavailable/);
  assert.match(catalogPricingNotice("unavailable", false).title, /not configured/);
  assert.match(catalogPricingNotice("unavailable", true).detail, /authorized API contract/);
});
