import { requireUser, routeError } from "@/lib/server/auth";
import {
  loadSteamInventory,
  type SteamCatalogMetadata,
  type SteamInventoryResult,
} from "@/lib/server/steam-inventory";
import { loadSkinCatalog } from "@/lib/server/skins";

export const runtime = "nodejs";

function inventoryJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

async function exactCatalogIndex() {
  const index = new Map<string, SteamCatalogMetadata>();
  try {
    for (const item of await loadSkinCatalog()) {
      if (!item.marketHashName || index.has(item.marketHashName)) continue;
      index.set(item.marketHashName, {
        id: item.id,
        marketHashName: item.marketHashName,
        name: item.name,
        weapon: item.weapon,
        category: item.category,
        weaponCategory: item.weaponCategory,
        itemType: item.itemType,
        type: item.type,
        rarity: item.rarity,
        rarityId: item.rarityId,
        rarityColor: item.rarityColor,
        wear: item.wear || undefined,
        collection: item.collections[0],
        collections: item.collections,
        image: item.image,
      });
    }
  } catch {
    // Steam ownership data remains usable when optional catalog enrichment fails.
  }
  return index;
}

function publicInventoryItem(item: SteamInventoryResult["items"][number]) {
  const catalog = item.catalog;
  return {
    // Legacy fields used by the current workspace.
    id: item.assetId,
    amount: item.quantity,
    name: item.name,
    type: catalog?.type || item.type || "CS2 item",
    weapon: catalog?.weapon || item.name.split(" | ")[0],
    category: catalog?.category || catalog?.itemType || item.type || "Other",
    rarity: catalog?.rarity || "",
    wear: catalog?.wear || item.name.match(/\(([^)]+)\)$/)?.[1] || "",
    color: catalog?.rarityColor || "b0b8c6",
    iconUrl: item.iconLargeUrl || item.iconUrl || catalog?.image || null,
    fallbackIconUrl: catalog?.image || null,
    tradable: item.tradable,
    marketable: item.marketable,
    details: item.descriptionLines.slice(0, 5),

    // Authoritative ownership and snapshot fields.
    assetId: item.assetId,
    classId: item.classId,
    instanceId: item.instanceId,
    quantity: item.quantity,
    marketHashName: item.marketHashName,
    iconId: item.iconId,
    iconLargeId: item.iconLargeId,
    actions: item.actions,
    tags: item.tags,
    metadata: catalog,
  };
}

function inventoryFailure(result: SteamInventoryResult) {
  const common = {
    connected: true,
    steamId: result.steamId64,
    state: result.state,
    items: [],
    total: 0,
    truncated: false,
    error: result.error?.message || "Steam inventory is temporarily unavailable.",
  };
  switch (result.state) {
    case "private":
      return inventoryJson({ ...common, private: true });
    case "rate_limited":
      return inventoryJson(
        { ...common, retryAfterSeconds: result.retryAfterSeconds },
        { status: 429 },
      );
    case "timeout":
      return inventoryJson(common, { status: 504 });
    case "malformed":
    case "unavailable":
      return inventoryJson(common, { status: 502 });
    default:
      return inventoryJson(common, { status: 502 });
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (!user.steamId) {
      return inventoryJson({
        connected: false,
        state: "disconnected",
        items: [],
        total: 0,
      });
    }
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.has("refresh") ||
      url.searchParams.has("retry");
    const [catalog, result] = await Promise.all([
      exactCatalogIndex(),
      loadSteamInventory(user.steamId, { forceRefresh }),
    ]);
    const enriched = result.items.length
      ? await loadSteamInventory(user.steamId, { catalogIndex: catalog })
      : result;
    if (enriched.state !== "success" && enriched.state !== "empty") {
      return inventoryFailure(enriched);
    }
    const items = enriched.items.map(publicInventoryItem);
    return inventoryJson({
      connected: true,
      private: false,
      state: enriched.state,
      steamId: user.steamId,
      total: enriched.total,
      truncated: enriched.truncated,
      source: "Steam Community Inventory + CSGO-API",
      empty: enriched.state === "empty",
      cache: enriched.cache,
      items,
    });
  } catch (error) {
    return routeError(error);
  }
}
