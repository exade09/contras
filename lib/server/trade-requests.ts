import type { SaleItemSnapshot } from "@/db/schema";

export const MAX_SALE_REQUEST_ITEMS = 20;
export const SUPPORTED_SALE_CURRENCIES = ["USD", "EUR", "RUB"] as const;

export type SaleCurrency = typeof SUPPORTED_SALE_CURRENCIES[number];
export type TradeRequestStatus =
  | "pending"
  | "contacted"
  | "accepted"
  | "rejected"
  | "completed"
  | "cancelled";

export type TradeRequestRow = {
  id: string;
  user_id: string;
  steam_id: string;
  steam_profile_url: string;
  amount_cents: number;
  currency: string;
  status: string;
  note: string;
  created_at: string;
  updated_at: string;
  login?: string | null;
  display_name?: string | null;
};

export type TradeRequestItemRow = {
  id: string;
  request_id: string;
  asset_id: string | null;
  class_id: string | null;
  instance_id: string | null;
  app_id: number;
  context_id: string;
  catalog_id: string | null;
  market_hash_name: string | null;
  name: string;
  quantity: number;
  icon_url: string | null;
  inspect_link: string | null;
  item_type: string | null;
  weapon: string | null;
  category: string | null;
  rarity: string | null;
  rarity_color: string | null;
  wear: string | null;
  collection: string | null;
  tradable: boolean;
  marketable: boolean;
  snapshot: SaleItemSnapshot;
  created_at: string;
};

export type TradeRequestRecord = {
  id: string;
  userId: string;
  steamId: string;
  amountCents: number;
  currency: string;
  status: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  login?: string | null;
  displayName?: string | null;
};

export type TradeRequestItemRecord = {
  id: string;
  requestId: string;
  assetId: string | null;
  classId: string | null;
  instanceId: string | null;
  appId: number;
  contextId: string;
  catalogId: string | null;
  marketHashName: string | null;
  name: string;
  quantity: number;
  iconUrl: string | null;
  inspectLink: string | null;
  itemType: string | null;
  weapon: string | null;
  category: string | null;
  rarity: string | null;
  rarityColor: string | null;
  wear: string | null;
  collection: string | null;
  tradable: boolean;
  marketable: boolean;
  snapshot: SaleItemSnapshot;
  createdAt: string;
};

export function serializeTradeRequest(record: TradeRequestRecord): TradeRequestRow {
  return {
    id: record.id,
    user_id: record.userId,
    steam_id: record.steamId,
    steam_profile_url: `https://steamcommunity.com/profiles/${record.steamId}`,
    amount_cents: record.amountCents,
    currency: record.currency,
    status: record.status,
    note: record.note,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    ...(record.login === undefined ? {} : { login: record.login }),
    ...(record.displayName === undefined ? {} : { display_name: record.displayName }),
  };
}

export function serializeTradeRequestItem(
  record: TradeRequestItemRecord,
): TradeRequestItemRow {
  return {
    id: record.id,
    request_id: record.requestId,
    asset_id: record.assetId,
    class_id: record.classId,
    instance_id: record.instanceId,
    app_id: record.appId,
    context_id: record.contextId,
    catalog_id: record.catalogId,
    market_hash_name: record.marketHashName,
    name: record.name,
    quantity: record.quantity,
    icon_url: record.iconUrl,
    inspect_link: record.inspectLink,
    item_type: record.itemType,
    weapon: record.weapon,
    category: record.category,
    rarity: record.rarity,
    rarity_color: record.rarityColor,
    wear: record.wear,
    collection: record.collection,
    tradable: record.tradable,
    marketable: record.marketable,
    snapshot: record.snapshot,
    created_at: record.createdAt,
  };
}

export function groupTradeRequests(
  requests: TradeRequestRow[],
  items: TradeRequestItemRow[],
) {
  const itemsByRequest = new Map<string, TradeRequestItemRow[]>();
  for (const item of items) {
    const group = itemsByRequest.get(item.request_id) || [];
    group.push(item);
    itemsByRequest.set(item.request_id, group);
  }
  return requests.map((request) => ({
    ...request,
    items: itemsByRequest.get(request.id) || [],
  }));
}

export function parseDesiredAmountCents(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000
    ? cents
    : null;
}

export type AssetIdValidation =
  | { ok: true; assetIds: string[] }
  | { ok: false; error: "required" | "too_many" | "invalid" | "duplicate" };

export function validateOwnedAssetIds(
  value: unknown,
  maximum = MAX_SALE_REQUEST_ITEMS,
): AssetIdValidation {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "required" };
  }
  if (value.length > maximum) return { ok: false, error: "too_many" };
  const assetIds: string[] = [];
  const seen = new Set<string>();
  for (const valueItem of value) {
    if (typeof valueItem !== "string" || !/^\d{1,40}$/.test(valueItem)) {
      return { ok: false, error: "invalid" };
    }
    if (seen.has(valueItem)) return { ok: false, error: "duplicate" };
    seen.add(valueItem);
    assetIds.push(valueItem);
  }
  return { ok: true, assetIds };
}

export type VerifiedOwnedAssetSelection<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: "missing" | "partial_inventory"; missingAssetIds: string[] };

export function selectVerifiedOwnedAssets<T extends { assetId: string }>(
  requestedAssetIds: readonly string[],
  authoritativeItems: readonly T[],
  inventoryTruncated = false,
): VerifiedOwnedAssetSelection<T> {
  const ownedByAssetId = new Map(authoritativeItems.map((item) => [item.assetId, item]));
  const missingAssetIds = requestedAssetIds.filter((assetId) => !ownedByAssetId.has(assetId));
  if (missingAssetIds.length) {
    return {
      ok: false,
      reason: inventoryTruncated ? "partial_inventory" : "missing",
      missingAssetIds,
    };
  }
  return {
    ok: true,
    items: requestedAssetIds.map((assetId) => ownedByAssetId.get(assetId)!),
  };
}

export function isSaleCurrency(value: unknown): value is SaleCurrency {
  return typeof value === "string" &&
    (SUPPORTED_SALE_CURRENCIES as readonly string[]).includes(value);
}

const ADMIN_TRANSITIONS: Record<TradeRequestStatus, readonly TradeRequestStatus[]> = {
  pending: ["contacted", "accepted", "rejected"],
  contacted: ["accepted", "rejected"],
  accepted: ["completed", "rejected"],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function isTradeRequestStatus(value: unknown): value is TradeRequestStatus {
  return typeof value === "string" && value in ADMIN_TRANSITIONS;
}

export function canAdminTransitionTradeRequest(
  current: TradeRequestStatus,
  next: TradeRequestStatus,
) {
  return ADMIN_TRANSITIONS[current].includes(next);
}

export function trustedSteamIcon(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && [
      "community.akamai.steamstatic.com",
      "community.cloudflare.steamstatic.com",
      "community.fastly.steamstatic.com",
    ].includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}
