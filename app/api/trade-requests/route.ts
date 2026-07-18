import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  tradeRequestItems,
  tradeRequests,
  userPaymentProfiles,
  type SaleItemSnapshot,
} from "@/db/schema";
import { requireUser, routeError } from "@/lib/server/auth";
import { configuredSteamInventoryLoader } from "@/lib/server/configured-steam-inventory";
import { encodePaymentNote } from "@/lib/server/payment-details";
import { formatUserPaymentProfile } from "@/lib/server/payment-profile";
import { loadSkinCatalog, type CatalogSkin } from "@/lib/server/skins";
import {
  groupTradeRequests,
  isSaleCurrency,
  MAX_SALE_REQUEST_ITEMS,
  parseDesiredAmountCents,
  selectVerifiedOwnedAssets,
  serializeTradeRequest,
  serializeTradeRequestItem,
  validateOwnedAssetIds,
} from "@/lib/server/trade-requests";
import { cleanText, jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";
export const maxDuration = 45;

async function requestsForUser(userId: string) {
  const db = getDb();
  const requests = await db.select().from(tradeRequests)
    .where(eq(tradeRequests.userId, userId))
    .orderBy(desc(tradeRequests.createdAt))
    .limit(50);
  if (!requests.length) return [];
  const items = await db.select().from(tradeRequestItems)
    .where(inArray(tradeRequestItems.requestId, requests.map((request) => request.id)))
    .orderBy(tradeRequestItems.createdAt);
  return groupTradeRequests(
    requests.map(serializeTradeRequest),
    items.map(serializeTradeRequestItem),
  );
}

function exactCatalog(items: CatalogSkin[]) {
  const result = new Map<string, CatalogSkin>();
  for (const item of items) {
    if (item.marketHashName && !result.has(item.marketHashName)) {
      result.set(item.marketHashName, item);
    }
  }
  return result;
}

function jsonSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as SaleItemSnapshot;
}

function ownershipFailure(state: string, message?: string) {
  switch (state) {
    case "private":
      return jsonError("Steam inventory is private. Item ownership could not be verified.", 409);
    case "rate_limited":
      return jsonError("Steam temporarily rate-limited ownership verification.", 429);
    case "timeout":
      return jsonError("Steam ownership verification timed out.", 504);
    case "empty":
      return jsonError("The selected items are not present in this Steam inventory.", 409);
    default:
      return jsonError(message || "Steam ownership could not be verified right now.", 503);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json(
      { requests: await requestsForUser(user.id) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const user = await requireUser(request);
    if (!user.steamId) {
      return jsonError("Connect a Steam account before submitting a sale request");
    }
    const body = await request.json().catch(() => null) as {
      assetIds?: unknown;
      amount?: unknown;
      currency?: unknown;
      note?: unknown;
    } | null;
    if (!body) return jsonError("Invalid request body");

    const assetValidation = validateOwnedAssetIds(body.assetIds);
    if (!assetValidation.ok) {
      const messages = {
        required: "Select at least one owned Steam inventory item",
        too_many: `Select no more than ${MAX_SALE_REQUEST_ITEMS} items`,
        invalid: "Every selected item must have a valid Steam asset ID",
        duplicate: "The same Steam asset cannot be selected more than once",
      } as const;
      return jsonError(messages[assetValidation.error]);
    }
    const amountCents = parseDesiredAmountCents(body.amount);
    if (amountCents === null) return jsonError("Enter a valid desired amount");
    if (!isSaleCurrency(body.currency)) return jsonError("Select a supported currency");
    const currency = body.currency;
    const note = cleanText(body.note, 600);

    const [inventory, catalogItems] = await Promise.all([
      configuredSteamInventoryLoader.load(user.steamId, { forceRefresh: true }),
      loadSkinCatalog().catch(() => [] as CatalogSkin[]),
    ]);
    if (inventory.state !== "success") {
      return ownershipFailure(inventory.state, inventory.error?.message);
    }
    const ownership = selectVerifiedOwnedAssets(
      assetValidation.assetIds,
      inventory.items,
      inventory.truncated,
    );
    if (!ownership.ok) {
      if (ownership.reason === "partial_inventory") {
        return jsonError(
          "Steam returned a partial inventory, so every selected item could not be verified.",
          503,
        );
      }
      return jsonError(
        "One or more selected items are no longer present in this Steam inventory.",
        409,
      );
    }

    const catalogByMarketName = exactCatalog(catalogItems);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const selectedItems = ownership.items.map((item) => {
      const catalog = item.marketHashName
        ? catalogByMarketName.get(item.marketHashName) || null
        : null;
      const iconUrl = item.iconLargeUrl || item.iconUrl || catalog?.image || null;
      const inspectLink = item.actions.find((action) =>
        action.source === "action" && /inspect/i.test(action.name),
      )?.link || item.actions.find((action) => action.source === "action")?.link || null;
      const snapshot = jsonSnapshot({
        capturedAt: now,
        ownershipSource: "Steam Community Inventory",
        appId: 730,
        contextId: "2",
        assetId: item.assetId,
        classId: item.classId,
        instanceId: item.instanceId,
        quantity: item.quantity,
        marketHashName: item.marketHashName,
        name: item.name,
        type: item.type,
        tradable: item.tradable,
        marketable: item.marketable,
        iconUrl: item.iconUrl,
        iconLargeUrl: item.iconLargeUrl,
        descriptionLines: item.descriptionLines,
        actions: item.actions,
        tags: item.tags,
        catalog: catalog ? {
          id: catalog.id,
          marketHashName: catalog.marketHashName,
          weapon: catalog.weapon,
          category: catalog.category,
          weaponCategory: catalog.weaponCategory,
          itemType: catalog.itemType,
          rarity: catalog.rarity,
          rarityId: catalog.rarityId,
          rarityColor: catalog.rarityColor,
          wear: catalog.wear,
          collections: catalog.collections,
          image: catalog.image,
        } : null,
      });
      return {
        id: crypto.randomUUID(),
        requestId: id,
        assetId: item.assetId,
        classId: item.classId,
        instanceId: item.instanceId,
        appId: 730,
        contextId: "2",
        catalogId: catalog?.id || null,
        marketHashName: item.marketHashName,
        name: item.name,
        quantity: item.quantity,
        iconUrl,
        inspectLink,
        itemType: catalog?.itemType || item.type,
        weapon: catalog?.weapon || null,
        category: catalog?.category || null,
        rarity: catalog?.rarity || null,
        rarityColor: catalog?.rarityColor || null,
        wear: catalog?.wear || null,
        collection: catalog?.collections[0] || null,
        tradable: item.tradable,
        marketable: item.marketable,
        snapshot,
        createdAt: now,
      };
    });

    const db = getDb();
    const inserted = await db.transaction(async (transaction) => {
      await transaction.execute(sql`select id from users where id = ${user.id} for update`);
      const paymentProfileRows = await transaction.select().from(userPaymentProfiles)
        .where(eq(userPaymentProfiles.userId, user.id)).limit(1);
      const paymentProfile = paymentProfileRows[0];
      const requestNote = paymentProfile
        ? encodePaymentNote(note, "kaspi_card", formatUserPaymentProfile(paymentProfile))
        : note;
      const activeRows = await transaction.select({ total: count() })
        .from(tradeRequests)
        .where(and(
          eq(tradeRequests.userId, user.id),
          inArray(tradeRequests.status, ["pending", "contacted", "accepted"]),
        ));
      if ((activeRows[0]?.total || 0) >= 10) return false;
      await transaction.insert(tradeRequests).values({
        id,
        userId: user.id,
        steamId: user.steamId!,
        amountCents,
        currency,
        status: "pending",
        note: requestNote,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(tradeRequestItems).values(selectedItems);
      return true;
    });
    if (!inserted) return jsonError("You already have 10 active requests", 409);
    return Response.json(
      { request: { id, status: "pending" } },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const user = await requireUser(request);
    const body = await request.json().catch(() => null) as {
      id?: unknown;
      status?: unknown;
    } | null;
    const id = cleanText(body?.id, 64);
    if (!id || body?.status !== "cancelled") {
      return jsonError("Only pending requests can be cancelled");
    }
    const updated = await getDb().update(tradeRequests).set({
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(tradeRequests.id, id),
      eq(tradeRequests.userId, user.id),
      eq(tradeRequests.status, "pending"),
    )).returning({ id: tradeRequests.id });
    if (!updated.length) return jsonError("Request cannot be cancelled", 409);
    return Response.json(
      { ok: true, status: "cancelled" },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
