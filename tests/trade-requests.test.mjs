import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminTransitionTradeRequest,
  parseDesiredAmountCents,
  serializeTradeRequest,
  serializeTradeRequestItem,
  selectVerifiedOwnedAssets,
  validateOwnedAssetIds,
} from "../lib/server/trade-requests.ts";
import { encodePaymentNote } from "../lib/server/payment-details.ts";

test("desired amounts parse to integer cents without floating-point conversion", () => {
  assert.equal(parseDesiredAmountCents("1"), 100);
  assert.equal(parseDesiredAmountCents("1.2"), 120);
  assert.equal(parseDesiredAmountCents("124.50"), 12_450);
  assert.equal(parseDesiredAmountCents("0.01"), 1);
  assert.equal(parseDesiredAmountCents("1.234"), null);
  assert.equal(parseDesiredAmountCents("1e3"), null);
  assert.equal(parseDesiredAmountCents(12.5), null);
  assert.equal(parseDesiredAmountCents("10000000.01"), null);
});

test("owned asset IDs reject missing, malformed, duplicate, and oversized selections", () => {
  assert.deepEqual(validateOwnedAssetIds(["100", "200"]), {
    ok: true,
    assetIds: ["100", "200"],
  });
  assert.equal(validateOwnedAssetIds([]).error, "required");
  assert.equal(validateOwnedAssetIds(["catalog-100"]).error, "invalid");
  assert.equal(validateOwnedAssetIds(["100", "100"]).error, "duplicate");
  assert.equal(validateOwnedAssetIds(
    Array.from({ length: 21 }, (_, index) => String(index + 1)),
  ).error, "too_many");
});

test("sale selection resolves only exact asset IDs from the authoritative Steam inventory", () => {
  const owned = [
    { assetId: "100", name: "Owned AK-47" },
    { assetId: "200", name: "Owned Sticker" },
  ];
  assert.deepEqual(selectVerifiedOwnedAssets(["200", "100"], owned), {
    ok: true,
    items: [owned[1], owned[0]],
  });
  assert.deepEqual(selectVerifiedOwnedAssets(["catalog-item-id"], owned), {
    ok: false,
    reason: "missing",
    missingAssetIds: ["catalog-item-id"],
  });
  assert.deepEqual(selectVerifiedOwnedAssets(["999"], owned, true), {
    ok: false,
    reason: "partial_inventory",
    missingAssetIds: ["999"],
  });
});

test("admin status transitions move forward and terminal states stay terminal", () => {
  assert.equal(canAdminTransitionTradeRequest("pending", "contacted"), true);
  assert.equal(canAdminTransitionTradeRequest("pending", "accepted"), true);
  assert.equal(canAdminTransitionTradeRequest("contacted", "accepted"), true);
  assert.equal(canAdminTransitionTradeRequest("accepted", "completed"), true);
  assert.equal(canAdminTransitionTradeRequest("completed", "pending"), false);
  assert.equal(canAdminTransitionTradeRequest("rejected", "accepted"), false);
  assert.equal(canAdminTransitionTradeRequest("cancelled", "pending"), false);
  assert.equal(canAdminTransitionTradeRequest("contacted", "pending"), false);
});

test("administrator request payload includes the verified Steam profile, asset ID, and immutable snapshot", () => {
  const request = serializeTradeRequest({
    id: "request-1", userId: "user-1", steamId: "76561198000000000",
    amountCents: 12_450, currency: "USD", status: "pending", note: "Manual review",
    createdAt: "2026-07-18T12:00:00.000Z", updatedAt: "2026-07-18T12:01:00.000Z",
    login: "client", displayName: "Client",
  });
  const snapshot = { ownershipSource: "Steam Community Inventory", capturedAt: "2026-07-18T12:00:00.000Z" };
  const item = serializeTradeRequestItem({
    id: "item-1", requestId: "request-1", assetId: "100", classId: "10", instanceId: "0",
    appId: 730, contextId: "2", catalogId: "catalog-1",
    marketHashName: "AK-47 | Redline (Field-Tested)", name: "AK-47 | Redline (Field-Tested)",
    quantity: 1, iconUrl: "https://community.fastly.steamstatic.com/economy/image/safe/512fx384f",
    inspectLink: null, itemType: "Weapon Skins", weapon: "AK-47", category: "Rifles",
    rarity: "Classified", rarityColor: "d32ce6", wear: "Field-Tested", collection: "The Phoenix Collection",
    tradable: true, marketable: true, snapshot, createdAt: "2026-07-18T12:00:00.000Z",
  });
  assert.equal(request.steam_profile_url, "https://steamcommunity.com/profiles/76561198000000000");
  assert.equal(request.login, "client");
  assert.equal(item.asset_id, "100");
  assert.equal(item.app_id, 730);
  assert.equal(item.context_id, "2");
  assert.deepEqual(item.snapshot, snapshot);
});

test("request serialization exposes payment fields separately from the client note", () => {
  const request = serializeTradeRequest({
    id: "request-payment", userId: "user-1", steamId: "76561198000000000",
    amountCents: 10_000, currency: "USD", status: "accepted",
    note: encodePaymentNote("Call after 18:00", "kaspi_card", "Recipient · phone ending 0000"),
    createdAt: "2026-07-18T12:00:00.000Z", updatedAt: "2026-07-18T12:01:00.000Z",
  });
  assert.equal(request.note, "Call after 18:00");
  assert.equal(request.payment_method, "kaspi_card");
  assert.equal(request.payment_details, "Recipient · phone ending 0000");
});
