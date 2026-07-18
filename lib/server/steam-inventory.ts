/** Pure, read-only Steam Community inventory loading and normalization. */

export const STEAM_CS2_APP_ID = "730";
export const STEAM_CS2_CONTEXT_ID = "2";
export const STEAM_INVENTORY_LANGUAGE = "english";
export const STEAM_INVENTORY_BASE_URL = "https://steamcommunity.com/inventory/";
export const STEAMAPIS_INVENTORY_ORIGIN = "https://api.steamapis.com";

const DEFAULT_PAGE_SIZE = 2_000;
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 200;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_PRIVATE_CACHE_TTL_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export type InventoryFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SteamInventoryState =
  | "disconnected"
  | "success"
  | "empty"
  | "private"
  | "rate_limited"
  | "timeout"
  | "malformed"
  | "unavailable";

export type SteamInventoryFallbackIssue =
  | "not_configured"
  | "key_rejected"
  | "account_or_quota"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "invalid_response";

export type SteamInventoryErrorCode = Exclude<
  SteamInventoryState,
  "disconnected" | "success" | "empty"
>;

export type SteamInventoryError = {
  code: SteamInventoryErrorCode;
  message: string;
  retryable: boolean;
};

export type SteamInventoryAction = {
  name: string;
  link: string;
  source: "action" | "market_action";
};

export type SteamInventoryTag = {
  category: string;
  name: string;
  color: string | null;
};

export type SteamCatalogMetadata = {
  id?: string;
  marketHashName?: string;
  name?: string;
  weapon?: string;
  category?: string;
  weaponCategory?: string;
  itemType?: string;
  type?: string;
  rarity?: string;
  rarityId?: string | null;
  rarityColor?: string;
  wear?: string;
  collection?: string;
  collections?: string[];
  image?: string | null;
};

export type SteamInventoryItem = {
  /** Authoritative Steam asset ID. */
  assetId: string;
  classId: string;
  instanceId: string;
  quantity: number;
  marketHashName: string | null;
  name: string;
  type: string | null;
  tradable: boolean;
  marketable: boolean;
  iconId: string | null;
  iconLargeId: string | null;
  iconUrl: string | null;
  iconLargeUrl: string | null;
  descriptionLines: string[];
  actions: SteamInventoryAction[];
  tags: SteamInventoryTag[];
  catalog: SteamCatalogMetadata | null;
};

export type SteamInventoryResult = {
  state: SteamInventoryState;
  connected: boolean;
  steamId64: string | null;
  items: SteamInventoryItem[];
  total: number;
  truncated: boolean;
  pagesLoaded: number;
  fetchedAt: string | null;
  cache: "miss" | "hit" | "coalesced" | "bypass";
  error?: SteamInventoryError;
  retryAfterSeconds?: number;
  fallbackIssue?: SteamInventoryFallbackIssue;
};

export type SteamInventoryCatalogIndex =
  | ReadonlyMap<string, SteamCatalogMetadata>
  | Readonly<Record<string, SteamCatalogMetadata>>;

export type SteamInventoryLoadOptions = {
  forceRefresh?: boolean;
  catalogIndex?: SteamInventoryCatalogIndex;
  catalogLookup?: (
    item: Omit<SteamInventoryItem, "catalog">,
  ) => SteamCatalogMetadata | null | undefined | Promise<SteamCatalogMetadata | null | undefined>;
};

export type SteamInventoryLoader = {
  load: (
    steamId64: string | null | undefined,
    options?: SteamInventoryLoadOptions,
  ) => Promise<SteamInventoryResult>;
  clear: (steamId64?: string) => void;
};

export type SteamInventoryLoaderConfig = {
  fetchImpl?: InventoryFetchLike;
  timeoutMs?: number;
  pageSize?: number;
  maxPages?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  cacheTtlMs?: number;
  privateCacheTtlMs?: number;
  maxResponseBytes?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type RawAsset = {
  assetId: string;
  classId: string;
  instanceId: string;
  quantity: number;
};

type RawAction = { name: string; link: string };

type RawDescription = {
  classId: string;
  instanceId: string;
  marketHashName: string | null;
  name: string | null;
  type: string | null;
  iconId: string | null;
  iconLargeId: string | null;
  tradable: boolean;
  marketable: boolean;
  descriptionLines: string[];
  actions: RawAction[];
  marketActions: RawAction[];
  tags: SteamInventoryTag[];
};

type ValidatedPage = {
  assets: RawAsset[];
  descriptions: RawDescription[];
  total: number;
  moreItems: boolean;
  lastAssetId: string | null;
};

type PageResult =
  | { kind: "page"; page: ValidatedPage }
  | { kind: "private" }
  | { kind: "rate_limited"; retryAfterSeconds?: number; fallbackIssue?: SteamInventoryFallbackIssue }
  | { kind: "timeout" }
  | { kind: "malformed" }
  | { kind: "unavailable" };

type CoreResult = Omit<SteamInventoryResult, "cache">;
type CachedResult = { expiresAt: number; result: CoreResult };

const FALLBACK_ISSUES = new Set<SteamInventoryFallbackIssue>([
  "not_configured",
  "key_rejected",
  "account_or_quota",
  "provider_rate_limited",
  "provider_unavailable",
  "invalid_response",
]);

function fallbackIssueResponse(primary: Response, issue: SteamInventoryFallbackIssue) {
  const headers = new Headers(primary.headers);
  headers.set("x-contras-inventory-fallback", issue);
  return new Response(primary.body, {
    status: primary.status,
    statusText: primary.statusText,
    headers,
  });
}

function fallbackIssue(response: Response) {
  const value = response.headers.get("x-contras-inventory-fallback");
  return value && FALLBACK_ISSUES.has(value as SteamInventoryFallbackIssue)
    ? value as SteamInventoryFallbackIssue
    : undefined;
}

function providerEnvelopeIssue(payload: Record<string, unknown>) {
  if (payload.success !== false || !isRecord(payload.error)) return "invalid_response";
  const message = typeof payload.error.message === "string"
    ? payload.error.message.toLocaleUpperCase("en-US")
    : "";
  if (/MISSING_API_KEY|INVALID_API_KEY|ACCESS_DENIED/.test(message)) {
    return "key_rejected";
  }
  if (/INSUFFICIENT_BALANCE|QUOTA|SUBSCRIPTION|PAYMENT/.test(message)) {
    return "account_or_quota";
  }
  return "invalid_response";
}

function findProviderInventory(
  payload: unknown,
  depth = 0,
): (Record<string, unknown> & { assets: unknown[]; descriptions: unknown[] }) | null {
  if (!isRecord(payload) || depth > 4) return null;
  if (Array.isArray(payload.assets) && Array.isArray(payload.descriptions)) {
    return payload as Record<string, unknown> & {
      assets: unknown[];
      descriptions: unknown[];
    };
  }
  for (const key of ["result", "response", "data", "inventory"]) {
    const nested = findProviderInventory(payload[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function createResilientSteamInventoryFetch(
  apiKey: string | null | undefined,
  fetchImpl: InventoryFetchLike = fetch,
): InventoryFetchLike {
  const fallbackKey = apiKey?.trim();
  return async (input, init) => {
    const primary = await fetchImpl(input, init);
    if (primary.status !== 429) return primary;
    if (!fallbackKey) return fallbackIssueResponse(primary, "not_configured");

    let steamId64: string | null = null;
    try {
      const primaryUrl = new URL(input instanceof Request ? input.url : input);
      const match = primaryUrl.pathname.match(/^\/inventory\/(\d{17})\/730\/2$/);
      if (primaryUrl.origin === "https://steamcommunity.com" && match) {
        steamId64 = match[1];
      }
    } catch {
      return primary;
    }
    if (!steamId64) return primary;

    const fallbackUrl = new URL(
      `/v2/steam/users/${steamId64}/inventory/${STEAM_CS2_APP_ID}/${STEAM_CS2_CONTEXT_ID}`,
      STEAMAPIS_INVENTORY_ORIGIN,
    );
    try {
      const fallback = await fetchImpl(fallbackUrl, {
        headers: {
          accept: "application/json",
          "user-agent": "contras.fun read-only Steam inventory fallback",
          "x-api-key": fallbackKey,
        },
        redirect: "error",
        signal: init?.signal,
      });
      if (!fallback.ok) {
        const issue = fallback.status === 401 || fallback.status === 403
          ? "key_rejected"
          : fallback.status === 400
            ? "account_or_quota"
            : fallback.status === 429
              ? "provider_rate_limited"
              : "provider_unavailable";
        return fallbackIssueResponse(primary, issue);
      }
      const declaredLength = Number(fallback.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > DEFAULT_MAX_RESPONSE_BYTES) {
        return fallbackIssueResponse(primary, "invalid_response");
      }
      const body = await fallback.text();
      if (body.length > DEFAULT_MAX_RESPONSE_BYTES) {
        return fallbackIssueResponse(primary, "invalid_response");
      }
      const payload = JSON.parse(body) as unknown;
      if (!isRecord(payload)) {
        return fallbackIssueResponse(primary, "invalid_response");
      }
      const result = findProviderInventory(payload);
      if (!result && payload.success === false) {
        return fallbackIssueResponse(primary, providerEnvelopeIssue(payload));
      }
      if (!result) return fallbackIssueResponse(primary, "invalid_response");
      return Response.json({
        ...result,
        success: 1,
        total_inventory_count: result.total_inventory_count ?? result.assets.length,
        more_items: result.more_items ?? false,
      }, {
        headers: { "x-contras-inventory-source": "steamapis-fallback" },
      });
    } catch {
      return fallbackIssueResponse(primary, "provider_unavailable");
    }
  };
}

export class SteamInventoryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SteamInventoryConfigurationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSteamId64(value: string) {
  return /^\d{17}$/.test(value) && /[1-9]/.test(value);
}

function digitString(value: unknown, maxLength = 40): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    /^\d+$/.test(value)
  );
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function optionalFlag(value: unknown) {
  if (value === undefined) return { valid: true, value: false } as const;
  if (value === 0 || value === false) return { valid: true, value: false } as const;
  if (value === 1 || value === true) return { valid: true, value: true } as const;
  return { valid: false, value: false } as const;
}

function inventoryError(
  code: SteamInventoryErrorCode,
  fallback?: SteamInventoryFallbackIssue,
): SteamInventoryError {
  switch (code) {
    case "private":
      return { code, message: "Steam inventory is private.", retryable: false };
    case "rate_limited":
      if (fallback === "not_configured") {
        return {
          code,
          message: "Steam rate-limited this server, and STEAMAPIS_API_KEY is not available in the Production deployment.",
          retryable: true,
        };
      }
      if (fallback === "key_rejected") {
        return {
          code,
          message: "SteamApis rejected STEAMAPIS_API_KEY. Verify the key, Production scope, and redeploy.",
          retryable: true,
        };
      }
      if (fallback === "account_or_quota") {
        return {
          code,
          message: "SteamApis fallback is not active or has no available request quota. Check Payment & subscriptions in SteamApis.",
          retryable: true,
        };
      }
      if (fallback === "provider_rate_limited") {
        return {
          code,
          message: "Both Steam and the SteamApis fallback are temporarily rate-limited.",
          retryable: true,
        };
      }
      if (fallback === "provider_unavailable") {
        return {
          code,
          message: "Steam is rate-limited and the SteamApis fallback did not respond before the request timeout.",
          retryable: true,
        };
      }
      if (fallback === "invalid_response") {
        return {
          code,
          message: "SteamApis returned an unexpected inventory response. Check that API v2 inventory access is enabled.",
          retryable: true,
        };
      }
      return {
        code,
        message: "Steam temporarily rate-limited inventory requests.",
        retryable: true,
      };
    case "timeout":
      return {
        code,
        message: "Steam inventory request timed out.",
        retryable: true,
      };
    case "malformed":
      return {
        code,
        message: "Steam returned an invalid inventory response.",
        retryable: true,
      };
    case "unavailable":
      return {
        code,
        message: "Steam inventory is temporarily unavailable.",
        retryable: true,
      };
  }
}

function errorResult(
  state: SteamInventoryErrorCode,
  steamId64: string,
  fetchedAt: string,
  pagesLoaded: number,
  retryAfterSeconds?: number,
  fallback?: SteamInventoryFallbackIssue,
): CoreResult {
  return {
    state,
    connected: true,
    steamId64,
    items: [],
    total: 0,
    truncated: false,
    pagesLoaded,
    fetchedAt,
    error: inventoryError(state, fallback),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(fallback === undefined ? {} : { fallbackIssue: fallback }),
  };
}

export function buildSteamInventoryUrl(
  steamId64: string,
  options: { pageSize?: number; startAssetId?: string } = {},
) {
  if (!isSteamId64(steamId64)) {
    throw new SteamInventoryConfigurationError("A valid SteamID64 is required.");
  }
  if (
    options.startAssetId !== undefined &&
    !digitString(options.startAssetId)
  ) {
    throw new SteamInventoryConfigurationError("Steam inventory cursor is invalid.");
  }
  const pageSize = Math.min(
    2_000,
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const url = new URL(
    `${steamId64}/${STEAM_CS2_APP_ID}/${STEAM_CS2_CONTEXT_ID}`,
    STEAM_INVENTORY_BASE_URL,
  );
  url.searchParams.set("l", STEAM_INVENTORY_LANGUAGE);
  url.searchParams.set("count", String(pageSize));
  if (options.startAssetId) {
    url.searchParams.set("start_assetid", options.startAssetId);
  }
  return url;
}

function safeIconId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value)
    ? value
    : null;
}

export function steamCdnImageUrl(
  iconId: string | null | undefined,
  size: "small" | "large" = "large",
) {
  const safeId = safeIconId(iconId);
  if (!safeId) return null;
  const dimensions = size === "small" ? "96fx96f" : "512fx384f";
  return `https://community.fastly.steamstatic.com/economy/image/${safeId}/${dimensions}`;
}

function cleanActionList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RawAction[] => {
    if (!isRecord(entry)) return [];
    const name = boundedString(entry.name, 120)?.trim();
    const link = boundedString(entry.link, 2_048)?.trim();
    return name && link ? [{ name, link }] : [];
  });
}

function cleanDescriptionLines(value: unknown) {
  if (value === undefined || !Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (!isRecord(entry)) return [];
    const line = boundedString(entry.value, 1_000)?.trim();
    return line ? [line] : [];
  }).slice(0, 20);
}

function cleanTags(value: unknown) {
  if (value === undefined || !Array.isArray(value)) return [];
  return value.flatMap((entry): SteamInventoryTag[] => {
    if (!isRecord(entry)) return [];
    const category = boundedString(entry.category, 120)?.trim();
    const name = boundedString(entry.localized_tag_name, 180)?.trim();
    const colorValue = boundedString(entry.color, 12);
    if (!category || !name) return [];
    return [{
      category,
      name,
      color: colorValue && /^[0-9a-f]{6}$/i.test(colorValue) ? colorValue : null,
    }];
  }).slice(0, 40);
}

function validateAsset(value: unknown): RawAsset | null {
  if (!isRecord(value)) return null;
  if (
    !digitString(value.assetid) ||
    !digitString(value.classid) ||
    !digitString(value.instanceid) ||
    !digitString(value.amount, 12)
  ) {
    return null;
  }
  const quantity = Number(value.amount);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  return {
    assetId: value.assetid,
    classId: value.classid,
    instanceId: value.instanceid,
    quantity,
  };
}

function validateDescription(value: unknown): RawDescription | null {
  if (!isRecord(value)) return null;
  if (!digitString(value.classid) || !digitString(value.instanceid)) return null;
  const tradable = optionalFlag(value.tradable);
  const marketable = optionalFlag(value.marketable);
  if (!tradable.valid || !marketable.valid) return null;
  if (
    (value.market_hash_name !== undefined && boundedString(value.market_hash_name, 512) === null) ||
    (value.name !== undefined && boundedString(value.name, 512) === null) ||
    (value.type !== undefined && boundedString(value.type, 512) === null)
  ) {
    return null;
  }
  return {
    classId: value.classid,
    instanceId: value.instanceid,
    marketHashName: boundedString(value.market_hash_name, 512)?.trim() || null,
    name: boundedString(value.name, 512)?.trim() || null,
    type: boundedString(value.type, 512)?.trim() || null,
    iconId: safeIconId(value.icon_url),
    iconLargeId: safeIconId(value.icon_url_large),
    tradable: tradable.value,
    marketable: marketable.value,
    descriptionLines: cleanDescriptionLines(value.descriptions),
    actions: cleanActionList(value.actions),
    marketActions: cleanActionList(value.market_actions),
    tags: cleanTags(value.tags),
  };
}

function parseTotal(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  const total = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0
    ? total
    : null;
}

function parseMoreItems(value: unknown) {
  if (value === undefined || value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  return null;
}

function privateSteamError(payload: Record<string, unknown>) {
  if (payload.success === 2 || payload.success === "2") return true;
  const rawError = [payload.Error, payload.error]
    .find((value) => typeof value === "string");
  return typeof rawError === "string" && /private|permission|access denied/i.test(rawError);
}

function validatePage(payload: unknown): PageResult {
  if (!isRecord(payload)) return { kind: "malformed" };
  const success = payload.success === true ? 1 : Number(payload.success);
  if (success !== 1) {
    return privateSteamError(payload)
      ? { kind: "private" }
      : { kind: "unavailable" };
  }
  if (
    (payload.assets !== undefined && !Array.isArray(payload.assets)) ||
    (payload.descriptions !== undefined && !Array.isArray(payload.descriptions))
  ) {
    return { kind: "malformed" };
  }

  const rawAssets = (payload.assets ?? []) as unknown[];
  const rawDescriptions = (payload.descriptions ?? []) as unknown[];
  const assets = rawAssets.map(validateAsset);
  const descriptions = rawDescriptions.map(validateDescription);
  if (assets.some((asset) => asset === null) || descriptions.some((description) => description === null)) {
    return { kind: "malformed" };
  }
  const total = parseTotal(payload.total_inventory_count, assets.length);
  const moreItems = parseMoreItems(payload.more_items);
  if (total === null || moreItems === null) return { kind: "malformed" };
  const lastAssetId = payload.last_assetid === undefined
    ? null
    : digitString(payload.last_assetid)
      ? payload.last_assetid
      : null;
  if (moreItems && !lastAssetId) return { kind: "malformed" };

  return {
    kind: "page",
    page: {
      assets: assets as RawAsset[],
      descriptions: descriptions as RawDescription[],
      total,
      moreItems,
      lastAssetId,
    },
  };
}

function parseRetryAfter(response: Response, now: number) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Math.max(0, Number(value.trim()));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1_000));
}

async function defaultSleep(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function safeActionLink(template: string, steamId64: string, assetId: string) {
  const materialized = template
    .replaceAll("%owner_steamid%", steamId64)
    .replaceAll("%assetid%", assetId);
  if (materialized.length > 2_048 || /%[A-Za-z_]+%/.test(materialized)) return null;
  try {
    const url = new URL(materialized);
    if (
      url.protocol === "steam:" &&
      url.hostname === "rungame" &&
      url.pathname.startsWith(`/${STEAM_CS2_APP_ID}/`)
    ) {
      return url.toString();
    }
    if (
      url.protocol === "https:" &&
      url.hostname === "steamcommunity.com"
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function materializeActions(
  description: RawDescription | undefined,
  steamId64: string,
  assetId: string,
) {
  if (!description) return [];
  const result: SteamInventoryAction[] = [];
  for (const [source, actions] of [
    ["action", description.actions],
    ["market_action", description.marketActions],
  ] as const) {
    for (const action of actions) {
      const link = safeActionLink(action.link, steamId64, assetId);
      if (link) result.push({ name: action.name, link, source });
    }
  }
  return result.slice(0, 10);
}

function mergeInventory(
  steamId64: string,
  assets: Map<string, RawAsset>,
  descriptions: Map<string, RawDescription>,
) {
  return Array.from(assets.values()).map((asset): SteamInventoryItem => {
    const description = descriptions.get(`${asset.classId}_${asset.instanceId}`);
    const marketHashName = description?.marketHashName ?? null;
    const name = marketHashName || description?.name || "Unknown CS2 item";
    return {
      assetId: asset.assetId,
      classId: asset.classId,
      instanceId: asset.instanceId,
      quantity: asset.quantity,
      marketHashName,
      name,
      type: description?.type ?? null,
      tradable: description?.tradable ?? false,
      marketable: description?.marketable ?? false,
      iconId: description?.iconId ?? null,
      iconLargeId: description?.iconLargeId ?? null,
      iconUrl: steamCdnImageUrl(description?.iconId, "small"),
      iconLargeUrl: steamCdnImageUrl(
        description?.iconLargeId ?? description?.iconId,
        "large",
      ),
      descriptionLines: description?.descriptionLines ?? [],
      actions: materializeActions(description, steamId64, asset.assetId),
      tags: description?.tags ?? [],
      catalog: null,
    };
  });
}

function catalogFromIndex(
  index: SteamInventoryCatalogIndex | undefined,
  marketHashName: string | null,
) {
  if (!index || !marketHashName) return null;
  if (index instanceof Map) return index.get(marketHashName) ?? null;
  return (index as Readonly<Record<string, SteamCatalogMetadata>>)[marketHashName] ?? null;
}

async function enrichResult(
  result: SteamInventoryResult,
  options: SteamInventoryLoadOptions,
) {
  if (!result.items.length || (!options.catalogIndex && !options.catalogLookup)) {
    return result;
  }
  const items = await Promise.all(result.items.map(async (item) => {
    const withoutCatalog = { ...item };
    delete (withoutCatalog as Partial<SteamInventoryItem>).catalog;
    const indexed = catalogFromIndex(options.catalogIndex, item.marketHashName);
    const lookedUp = options.catalogLookup
      ? await options.catalogLookup(withoutCatalog as Omit<SteamInventoryItem, "catalog">)
      : null;
    return { ...item, catalog: lookedUp ?? indexed ?? null };
  }));
  return { ...result, items };
}

export function createSteamInventoryLoader(
  config: SteamInventoryLoaderConfig = {},
): SteamInventoryLoader {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pageSize = Math.min(
    2_000,
    Math.max(1, Math.floor(config.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const maxPages = Math.min(
    50,
    Math.max(1, Math.floor(config.maxPages ?? DEFAULT_MAX_PAGES)),
  );
  const maxRetries = Math.min(
    5,
    Math.max(0, Math.floor(config.maxRetries ?? DEFAULT_MAX_RETRIES)),
  );
  const retryBaseMs = Math.max(0, config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const maxRetryDelayMs = Math.max(
    retryBaseMs,
    config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
  );
  const cacheTtlMs = Math.max(0, config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const privateCacheTtlMs = Math.max(
    0,
    config.privateCacheTtlMs ?? DEFAULT_PRIVATE_CACHE_TTL_MS,
  );
  const maxResponseBytes = Math.max(
    1_024,
    config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  );
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  const cache = new Map<string, CachedResult>();
  const inFlight = new Map<string, Promise<CoreResult>>();

  async function readPage(url: URL): Promise<PageResult> {
    let lastRetryAfter: number | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = (async () => {
          const response = await fetchImpl(url, {
            headers: {
              accept: "application/json",
              "user-agent": "contras.fun read-only Steam inventory viewer",
            },
            redirect: "error",
            signal: controller.signal,
          });
          if (response.status === 403) return { kind: "private" } as const;
          if (response.status === 429) {
            return {
              kind: "rate_limited",
              retryAfterSeconds: parseRetryAfter(response, now()),
              fallbackIssue: fallbackIssue(response),
            } as const;
          }
          if (!response.ok) {
            if (response.status >= 500) return { kind: "retryable" } as const;
            return { kind: "unavailable" } as const;
          }
          const declaredLength = Number(response.headers.get("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
            return { kind: "malformed" } as const;
          }
          const body = await response.text();
          if (body.length > maxResponseBytes) return { kind: "malformed" } as const;
          try {
            return validatePage(JSON.parse(body));
          } catch {
            return { kind: "malformed" } as const;
          }
        })();
        const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ kind: "timeout" });
          }, timeoutMs);
        });
        const result = await Promise.race([request, timeout]);
        if (result.kind === "private" || result.kind === "page" || result.kind === "malformed" || result.kind === "unavailable") {
          return result;
        }
        if (result.kind === "rate_limited") {
          lastRetryAfter = result.retryAfterSeconds;
          // Retrying a per-IP Steam 429 from the same function only extends the
          // throttle and delays the response. A configured fallback fetch gets
          // its chance before this branch is reached.
          return result;
        }
        if (result.kind === "timeout") {
          if (attempt === maxRetries) return { kind: "timeout" };
          await sleep(Math.min(maxRetryDelayMs, retryBaseMs * 2 ** attempt));
          continue;
        }
        if (result.kind === "retryable") {
          if (attempt === maxRetries) return { kind: "unavailable" };
          await sleep(Math.min(maxRetryDelayMs, retryBaseMs * 2 ** attempt));
        }
      } catch (error) {
        const timedOut = controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        if (attempt === maxRetries) {
          return timedOut ? { kind: "timeout" } : { kind: "unavailable" };
        }
        await sleep(Math.min(maxRetryDelayMs, retryBaseMs * 2 ** attempt));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    return lastRetryAfter === undefined
      ? { kind: "unavailable" }
      : { kind: "rate_limited", retryAfterSeconds: lastRetryAfter };
  }

  async function loadCore(steamId64: string): Promise<CoreResult> {
    const assets = new Map<string, RawAsset>();
    const descriptions = new Map<string, RawDescription>();
    let total = 0;
    let startAssetId: string | undefined;
    let pagesLoaded = 0;
    let truncated = false;

    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const pageResult = await readPage(buildSteamInventoryUrl(steamId64, {
        pageSize,
        startAssetId,
      }));
      const fetchedAt = new Date(now()).toISOString();
      if (pageResult.kind !== "page") {
        return errorResult(
          pageResult.kind,
          steamId64,
          fetchedAt,
          pagesLoaded,
          pageResult.kind === "rate_limited"
            ? pageResult.retryAfterSeconds
            : undefined,
          pageResult.kind === "rate_limited"
            ? pageResult.fallbackIssue
            : undefined,
        );
      }

      pagesLoaded += 1;
      total = Math.max(total, pageResult.page.total);
      for (const asset of pageResult.page.assets) assets.set(asset.assetId, asset);
      for (const description of pageResult.page.descriptions) {
        descriptions.set(
          `${description.classId}_${description.instanceId}`,
          description,
        );
      }

      if (!pageResult.page.moreItems) break;
      const nextAssetId = pageResult.page.lastAssetId;
      if (!nextAssetId || nextAssetId === startAssetId) {
        return errorResult("malformed", steamId64, fetchedAt, pagesLoaded);
      }
      startAssetId = nextAssetId;
      if (pageNumber === maxPages - 1) truncated = true;
    }

    const items = mergeInventory(steamId64, assets, descriptions);
    const fetchedAt = new Date(now()).toISOString();
    truncated ||= total > items.length;
    return {
      state: items.length ? "success" : "empty",
      connected: true,
      steamId64,
      items,
      total: Math.max(total, items.length),
      truncated,
      pagesLoaded,
      fetchedAt,
    };
  }

  function cacheLifetime(result: CoreResult) {
    if (result.state === "success" || result.state === "empty") return cacheTtlMs;
    if (result.state === "private") return privateCacheTtlMs;
    return 0;
  }

  return {
    async load(steamId64, options = {}) {
      if (steamId64 === null || steamId64 === undefined || steamId64 === "") {
        return {
          state: "disconnected",
          connected: false,
          steamId64: null,
          items: [],
          total: 0,
          truncated: false,
          pagesLoaded: 0,
          fetchedAt: null,
          cache: "bypass",
        };
      }
      if (!isSteamId64(steamId64)) {
        throw new SteamInventoryConfigurationError("A valid SteamID64 is required.");
      }

      const cached = cache.get(steamId64);
      if (!options.forceRefresh && cached && cached.expiresAt > now()) {
        return enrichResult({ ...cached.result, cache: "hit" }, options);
      }
      if (cached && cached.expiresAt <= now()) cache.delete(steamId64);

      let promise = inFlight.get(steamId64);
      let cacheState: SteamInventoryResult["cache"] = "coalesced";
      if (!promise) {
        cacheState = "miss";
        promise = loadCore(steamId64);
        inFlight.set(steamId64, promise);
        void promise.finally(() => {
          if (inFlight.get(steamId64) === promise) inFlight.delete(steamId64);
        });
      }
      const result = await promise;
      const ttl = cacheLifetime(result);
      if (ttl > 0) cache.set(steamId64, { result, expiresAt: now() + ttl });
      return enrichResult({ ...result, cache: cacheState }, options);
    },
    clear(steamId64) {
      if (steamId64) cache.delete(steamId64);
      else cache.clear();
    },
  };
}

const defaultSteamInventoryLoader = createSteamInventoryLoader();

export function loadSteamInventory(
  steamId64: string | null | undefined,
  options?: SteamInventoryLoadOptions,
) {
  return defaultSteamInventoryLoader.load(steamId64, options);
}

export function clearSteamInventoryCache(steamId64?: string) {
  defaultSteamInventoryLoader.clear(steamId64);
}
