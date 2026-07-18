import bundledFallback from "./fixtures/catalog-fallback.json" with { type: "json" };

export const DEFAULT_CSGO_API_BASE_URL =
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en";

const DEFAULT_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = [250, 1_000] as const;
const DEFAULT_TIMEOUT_MS = 12_000;
const FALLBACK_RETRY_MS = 5 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;

export type CatalogSource = "upstream" | "last-known-good" | "bundled-fallback";
export type CatalogSort = "default" | "name_asc" | "rarity" | "price_asc" | "price_desc";

export type CatalogPriceLike = {
  status: string;
  amountMinor: number | null;
};

export type CatalogSkin = {
  id: string;
  upstreamId: string;
  name: string;
  marketHashName: string | null;
  image: string | null;
  weapon: string;
  category: string;
  weaponCategory: string;
  itemType: string;
  type: string;
  rarity: string;
  rarityId: string | null;
  rarityColor: string;
  wear: string | null;
  wears: string[];
  collections: string[];
  stattrak: boolean;
  souvenir: boolean;
  phase: string | null;
  source: "all" | "skins_not_grouped" | "fallback";
  price?: CatalogPriceLike;
};

export type CatalogFacets = {
  itemTypes: string[];
  weaponCategories: string[];
  weapons: string[];
  rarities: string[];
  wears: string[];
  collections: string[];
};

export type CatalogQuery = {
  query?: string;
  itemType?: string;
  weaponCategory?: string;
  weapon?: string;
  rarity?: string;
  wear?: string;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
  offset?: number;
  onlyWithPrices?: boolean;
  minPriceMinor?: number;
  maxPriceMinor?: number;
};

export type CatalogQueryResult<T extends CatalogSkin = CatalogSkin> = {
  items: T[];
  total: number;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    rangeStart: number;
    rangeEnd: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  facets: CatalogFacets;
};

export type CatalogSnapshot = {
  items: CatalogSkin[];
  source: CatalogSource;
  fetchedAt: string;
  stale: boolean;
  errorCode?: CatalogUpstreamErrorCode;
};

export type CatalogUpstreamErrorCode =
  | "invalid_base_url"
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "invalid_json"
  | "invalid_schema";

export class CatalogUpstreamError extends Error {
  readonly code: CatalogUpstreamErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: CatalogUpstreamErrorCode, message: string, status = 502, retryable = false) {
    super(message);
    this.name = "CatalogUpstreamError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type CatalogFetchOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
};

type CatalogLoaderOptions = CatalogFetchOptions & {
  ttlMs?: number;
  now?: () => number;
  fallbackPayload?: { all: unknown; skins: unknown };
};

type CatalogLoader = (options?: { force?: boolean }) => Promise<CatalogSnapshot>;

const PISTOLS = new Set([
  "CZ75-Auto", "Desert Eagle", "Dual Berettas", "Five-SeveN", "Glock-18",
  "P2000", "P250", "R8 Revolver", "Tec-9", "USP-S",
]);
const SMGS = new Set(["MAC-10", "MP5-SD", "MP7", "MP9", "P90", "PP-Bizon", "UMP-45"]);
const SHOTGUNS = new Set(["MAG-7", "Nova", "Sawed-Off", "XM1014"]);
const MACHINE_GUNS = new Set(["M249", "Negev"]);
const SNIPER_RIFLES = new Set(["AWP", "G3SG1", "SCAR-20", "SSG 08"]);
const RIFLES = new Set(["AK-47", "AUG", "FAMAS", "Galil AR", "M4A1-S", "M4A4", "SG 553"]);

/** Canonical rarity labels visible in CS2 across weapons, stickers, agents, and other items. */
export const GAME_RARITIES = [
  "Base Grade",
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
  "Covert",
  "Contraband",
  "High Grade",
  "Remarkable",
  "Exotic",
  "Extraordinary",
  "Distinguished",
  "Exceptional",
  "Superior",
  "Master",
] as const;

const GAME_RARITY_SET = new Set<string>(GAME_RARITIES);
const RARITY_ALIASES = new Map([
  ["Default", "Base Grade"],
  ["Highlight Base Grade", "Base Grade"],
]);

export function canonicalGameRarity(value: unknown) {
  const rarity = textValue(value);
  const canonical = RARITY_ALIASES.get(rarity) || rarity;
  return GAME_RARITY_SET.has(canonical) ? canonical : "Base Grade";
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const valueText = textValue(value);
  return valueText || null;
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function nestedName(value: unknown) {
  return textValue(asRecord(value)?.name);
}

function namedValues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => nestedName(entry)).filter(Boolean);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function catalogEnvironment(): Record<string, string | undefined> {
  return typeof process !== "undefined" ? process.env : {};
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCatalogBaseUrl(value = catalogEnvironment().CSGO_API_BASE_URL) {
  const candidate = textValue(value) || DEFAULT_CSGO_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CatalogUpstreamError("invalid_base_url", "The CSGO-API base URL is invalid", 500);
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new CatalogUpstreamError("invalid_base_url", "The CSGO-API base URL must use HTTPS", 500);
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function trustedCatalogImage(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    if ([
      "community.akamai.steamstatic.com",
      "community.cloudflare.steamstatic.com",
      "community.fastly.steamstatic.com",
      "cdn.steamstatic.com",
      "steamcommunity-a.akamaihd.net",
    ].includes(hostname)) return url.toString();
    if (hostname === "raw.githubusercontent.com") {
      const pathname = url.pathname.toLocaleLowerCase("en-US");
      if (pathname.startsWith("/bymykel/csgo-api/") || pathname.startsWith("/bymykel/counter-strike-image-tracker/")) {
        return url.toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

function inferredWeapon(name: string, itemType: string) {
  if (itemType !== "Weapon Skins") return "";
  return name.replace(/^StatTrak(?:™)?\s+/i, "").replace(/^Souvenir\s+/i, "").split(" | ")[0].trim();
}

function inferItemType(upstreamId: string, raw: UnknownRecord, source: CatalogSkin["source"]) {
  if (source === "skins_not_grouped" || upstreamId.startsWith("skin-")) return "Weapon Skins";
  if (upstreamId.startsWith("agent-")) return "Agents";
  if (upstreamId.startsWith("sticker-") || upstreamId.startsWith("sticker_slab-")) return "Stickers";
  if (upstreamId.startsWith("crate-")) return "Crates and Cases";
  if (upstreamId.startsWith("patch-")) return "Patches";
  if (upstreamId.startsWith("graffiti-")) return "Graffiti";
  if (upstreamId.startsWith("keychain-") || upstreamId.startsWith("highlight-") || /charm/i.test(textValue(raw.name))) return "Charms";
  if (upstreamId.startsWith("music_kit-")) return "Music Kits";
  if (upstreamId.startsWith("key-") || upstreamId.startsWith("tool-")) return "Keys and Tools";
  if (upstreamId.startsWith("collectible-")) return "Collectibles";
  const rawType = textValue(raw.type).toLocaleLowerCase("en-US");
  if (rawType.includes("case") || rawType.includes("capsule") || rawType.includes("package")) return "Crates and Cases";
  return "Other";
}

export function normalizeWeaponCategory(rawCategory: string, weapon: string) {
  if (PISTOLS.has(weapon)) return "Pistols";
  if (SMGS.has(weapon)) return "SMGs";
  if (SHOTGUNS.has(weapon)) return "Shotguns";
  if (MACHINE_GUNS.has(weapon)) return "Machine Guns";
  if (SNIPER_RIFLES.has(weapon)) return "Sniper Rifles";
  if (RIFLES.has(weapon)) return "Rifles";
  if (/knife|bayonet|karambit|daggers/i.test(weapon) || /knife/i.test(rawCategory)) return "Knives";
  if (/glove|hand wrap/i.test(weapon) || /glove/i.test(rawCategory)) return "Gloves";
  return rawCategory || "Other";
}

function phaseValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return optionalText(String(value));
  return optionalText(asRecord(value)?.name);
}

function normalizeCatalogEntry(
  value: unknown,
  sourceKey: string,
  source: CatalogSkin["source"],
): CatalogSkin | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const name = textValue(raw.name);
  if (!name) return null;

  const marketHashName = optionalText(raw.market_hash_name);
  const rawId = textValue(raw.id) || textValue(sourceKey);
  if (!rawId && !marketHashName) return null;
  const itemType = inferItemType(rawId, raw, source);
  const weapon = nestedName(raw.weapon) || inferredWeapon(name, itemType);
  const rawCategory = nestedName(raw.category);
  const weaponCategory = itemType === "Weapon Skins" ? normalizeWeaponCategory(rawCategory, weapon) : "";
  const rarity = asRecord(raw.rarity);
  const rarityColor = textValue(rarity?.color).replace(/^#/, "");
  const wear = optionalText(nestedName(raw.wear));
  const wears = wear ? [wear] : namedValues(raw.wears);
  const stattrak = booleanValue(raw.stattrak) || /^StatTrak(?:™)?\s/i.test(marketHashName || name);
  const souvenir = booleanValue(raw.souvenir) || /^Souvenir\s/i.test(marketHashName || name);
  const stableAnchor = rawId || `${marketHashName}|${itemType}|${weapon}|${wear || ""}|${stattrak}|${souvenir}`;
  const upstreamId = rawId || `market-${stableHash(stableAnchor)}`;

  return {
    id: upstreamId,
    upstreamId,
    name,
    marketHashName,
    image: trustedCatalogImage(raw.image),
    weapon,
    category: itemType === "Weapon Skins" ? rawCategory || weaponCategory : itemType,
    weaponCategory,
    itemType,
    type: textValue(raw.type) || itemType,
    rarity: canonicalGameRarity(rarity?.name),
    rarityId: optionalText(rarity?.id),
    rarityColor: /^[0-9a-f]{6}$/i.test(rarityColor) ? rarityColor : "b0c3d9",
    wear,
    wears,
    collections: namedValues(raw.collections),
    stattrak,
    souvenir,
    phase: phaseValue(raw.phase),
    source,
  };
}

function entriesFromPayload(payload: unknown, label: string) {
  if (Array.isArray(payload)) return payload.map((value) => ["", value] as const);
  const record = asRecord(payload);
  if (record) return Object.entries(record);
  throw new CatalogUpstreamError("invalid_schema", `${label} must contain an object or array`, 502, true);
}

function richness(item: CatalogSkin) {
  return Number(Boolean(item.marketHashName)) * 4
    + Number(Boolean(item.image)) * 3
    + Number(Boolean(item.rarityId)) * 2
    + item.collections.length
    + Number(Boolean(item.wear));
}

export function deduplicateCatalog(items: CatalogSkin[]) {
  const output: CatalogSkin[] = [];
  const byId = new Map<string, number>();
  const byMarketHashName = new Map<string, number>();

  for (const item of items) {
    const marketKey = item.marketHashName || "";
    const existingIndex = byId.get(item.upstreamId) ?? (marketKey ? byMarketHashName.get(marketKey) : undefined);
    if (existingIndex === undefined) {
      const index = output.push(item) - 1;
      byId.set(item.upstreamId, index);
      if (marketKey) byMarketHashName.set(marketKey, index);
      continue;
    }
    if (richness(item) > richness(output[existingIndex])) output[existingIndex] = item;
    const selected = output[existingIndex];
    byId.set(item.upstreamId, existingIndex);
    byId.set(selected.upstreamId, existingIndex);
    if (marketKey) byMarketHashName.set(marketKey, existingIndex);
    if (selected.marketHashName) byMarketHashName.set(selected.marketHashName, existingIndex);
  }
  return output;
}

export function normalizeCatalogPayloads(
  allPayload: unknown,
  skinsNotGroupedPayload: unknown,
  source: "upstream" | "fallback" = "upstream",
) {
  const normalizedSource = source === "fallback" ? "fallback" : "all";
  const skinEntries = entriesFromPayload(skinsNotGroupedPayload, "skins_not_grouped");
  const variants = skinEntries
    .map(([key, value]) => normalizeCatalogEntry(value, key, source === "fallback" ? "fallback" : "skins_not_grouped"))
    .filter((item): item is CatalogSkin => Boolean(item));
  const useNormalizedVariants = variants.length > 0;
  const allItems = entriesFromPayload(allPayload, "all")
    .map(([key, value]) => normalizeCatalogEntry(value, key, normalizedSource))
    .filter((item): item is CatalogSkin => Boolean(item))
    .filter((item) => !(useNormalizedVariants && item.itemType === "Weapon Skins"));
  return deduplicateCatalog([...variants, ...allItems]);
}

function retryAfterMilliseconds(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), 5_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 5_000) : 0;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchJsonWithRetry(url: string, options: CatalogFetchOptions = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const retryDelays = options.retryDelaysMs || DEFAULT_RETRY_DELAY_MS;
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const sleep = options.sleep || defaultSleep;
  let lastError: CatalogUpstreamError | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfter = 0;
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "contras.fun catalog/1.0" },
        signal: controller.signal,
      });
      retryAfter = retryAfterMilliseconds(response);
      if (response.status === 429) {
        throw new CatalogUpstreamError("rate_limited", "CSGO-API temporarily rate-limited catalog requests", 429, true);
      }
      if (response.status >= 500) {
        throw new CatalogUpstreamError("upstream_error", `CSGO-API returned ${response.status}`, 502, true);
      }
      if (!response.ok) {
        throw new CatalogUpstreamError("upstream_error", `CSGO-API returned ${response.status}`, 502);
      }
      try {
        return await response.json() as unknown;
      } catch {
        throw new CatalogUpstreamError("invalid_json", "CSGO-API returned invalid JSON", 502, true);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = new CatalogUpstreamError("timeout", "CSGO-API catalog request timed out", 504, true);
      } else if (error instanceof CatalogUpstreamError) {
        lastError = error;
      } else {
        lastError = new CatalogUpstreamError("upstream_error", "CSGO-API catalog request failed", 502, true);
      }
      if (!lastError.retryable || attempt >= retryDelays.length) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(Math.max(retryDelays[attempt] || 0, retryAfter));
  }
  throw lastError || new CatalogUpstreamError("upstream_error", "CSGO-API catalog request failed", 502);
}

export async function fetchCatalogDocuments(options: CatalogFetchOptions = {}) {
  const baseUrl = resolveCatalogBaseUrl(options.baseUrl);
  const [all, skins] = await Promise.all([
    fetchJsonWithRetry(`${baseUrl}/all.json`, options),
    fetchJsonWithRetry(`${baseUrl}/skins_not_grouped.json`, options),
  ]);
  return { all, skins };
}

function fallbackItems(payload: { all: unknown; skins: unknown }) {
  try {
    return normalizeCatalogPayloads(payload.all, payload.skins, "fallback");
  } catch {
    return [];
  }
}

export function createCatalogLoader(options: CatalogLoaderOptions = {}): CatalogLoader {
  const now = options.now || Date.now;
  const ttlMs = positiveInteger(options.ttlMs, positiveInteger(catalogEnvironment().CSGO_API_CACHE_TTL_SECONDS, DEFAULT_CATALOG_TTL_MS / 1_000) * 1_000);
  const bundled = fallbackItems(options.fallbackPayload || bundledFallback);
  let cache: { snapshot: CatalogSnapshot; expiresAt: number } | null = null;
  let pending: Promise<CatalogSnapshot> | null = null;

  return async ({ force = false } = {}) => {
    const currentTime = now();
    if (!force && cache && cache.expiresAt > currentTime) return cache.snapshot;
    if (pending) return pending;

    pending = (async () => {
      try {
        const documents = await fetchCatalogDocuments(options);
        const items = normalizeCatalogPayloads(documents.all, documents.skins);
        if (!items.length) throw new CatalogUpstreamError("invalid_schema", "CSGO-API catalog contained no usable items", 502, true);
        const snapshot: CatalogSnapshot = {
          items,
          source: "upstream",
          fetchedAt: new Date(now()).toISOString(),
          stale: false,
        };
        cache = { snapshot, expiresAt: now() + ttlMs };
        return snapshot;
      } catch (error) {
        const catalogError = error instanceof CatalogUpstreamError
          ? error
          : new CatalogUpstreamError("upstream_error", "CSGO-API catalog request failed", 502, true);
        if (cache?.snapshot.items.length) {
          const snapshot: CatalogSnapshot = {
            ...cache.snapshot,
            source: cache.snapshot.source === "bundled-fallback" ? "bundled-fallback" : "last-known-good",
            stale: true,
            errorCode: catalogError.code,
          };
          cache = { snapshot, expiresAt: now() + FALLBACK_RETRY_MS };
          return snapshot;
        }
        const snapshot: CatalogSnapshot = {
          items: bundled,
          source: "bundled-fallback",
          fetchedAt: new Date(now()).toISOString(),
          stale: true,
          errorCode: catalogError.code,
        };
        cache = { snapshot, expiresAt: now() + FALLBACK_RETRY_MS };
        return snapshot;
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
}

const defaultCatalogLoader = createCatalogLoader();

export function loadCatalogSnapshot(options?: { force?: boolean }) {
  return defaultCatalogLoader(options);
}

export async function loadSkinCatalog() {
  return (await loadCatalogSnapshot()).items;
}

export function baseSkinName(value: string) {
  return value
    .replace(/^StatTrak(?:™)?\s+/i, "")
    .replace(/^Souvenir\s+/i, "")
    .replace(/\s+\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function catalogIndex(items: CatalogSkin[]) {
  const index = new Map<string, CatalogSkin>();
  for (const item of items) {
    const key = baseSkinName(item.marketHashName || item.name);
    const existing = index.get(key);
    if (!existing || richness(item) > richness(existing)) index.set(key, item);
  }
  return index;
}

function normalizedFilter(value: string | undefined) {
  return textValue(value).toLocaleLowerCase("en-US");
}

function matchesFilter(actual: string, expected: string | undefined) {
  const filter = normalizedFilter(expected);
  return !filter || filter === "all" || actual.toLocaleLowerCase("en-US") === filter;
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((left, right) => left.localeCompare(right, "en"));
}

export function buildCatalogFacets(items: CatalogSkin[]): CatalogFacets {
  return {
    itemTypes: uniqueSorted(items.map((item) => item.itemType)),
    weaponCategories: uniqueSorted(items.flatMap((item) => item.itemType === "Weapon Skins"
      ? [item.weaponCategory, item.category]
      : [])),
    weapons: uniqueSorted(items.map((item) => item.weapon)),
    rarities: GAME_RARITIES.filter((rarity) => items.some((item) => item.rarity === rarity)),
    wears: uniqueSorted(items.flatMap((item) => item.wears)),
    collections: uniqueSorted(items.flatMap((item) => item.collections)),
  };
}

function validPrice(item: CatalogSkin) {
  return (item.price?.status === "available" || item.price?.status === "stale")
    && Number.isSafeInteger(item.price.amountMinor)
    && Number(item.price.amountMinor) > 0;
}

function comparePrices(left: CatalogSkin, right: CatalogSkin, direction: 1 | -1) {
  const leftPriced = validPrice(left);
  const rightPriced = validPrice(right);
  if (leftPriced !== rightPriced) return leftPriced ? -1 : 1;
  if (!leftPriced || !rightPriced) return left.name.localeCompare(right.name, "en");
  const difference = Number(left.price!.amountMinor) - Number(right.price!.amountMinor);
  return difference === 0 ? left.name.localeCompare(right.name, "en") : difference * direction;
}

export function queryCatalog<T extends CatalogSkin>(items: T[], query: CatalogQuery = {}): CatalogQueryResult<T> {
  const search = normalizedFilter(query.query);
  const minimum = Number.isSafeInteger(query.minPriceMinor) && Number(query.minPriceMinor) >= 0 ? Number(query.minPriceMinor) : null;
  const maximum = Number.isSafeInteger(query.maxPriceMinor) && Number(query.maxPriceMinor) >= 0 ? Number(query.maxPriceMinor) : null;
  const matches = items.filter((item) => {
    const searchable = [
      item.name,
      item.marketHashName || "",
      item.weapon,
      item.weaponCategory,
      item.category,
      item.itemType,
      item.type,
      item.rarity,
      item.wear || "",
      ...item.collections,
    ].join(" ").toLocaleLowerCase("en-US");
    const hasPrice = validPrice(item);
    const amountMinor = hasPrice ? Number(item.price!.amountMinor) : null;
    return (!search || searchable.includes(search))
      && matchesFilter(item.itemType, query.itemType)
      && (matchesFilter(item.weaponCategory, query.weaponCategory) || matchesFilter(item.category, query.weaponCategory))
      && matchesFilter(item.weapon, query.weapon)
      && matchesFilter(item.rarity, query.rarity)
      && (!normalizedFilter(query.wear) || item.wears.some((wear) => matchesFilter(wear, query.wear)))
      && (!query.onlyWithPrices || hasPrice)
      && (minimum === null || (amountMinor !== null && amountMinor >= minimum))
      && (maximum === null || (amountMinor !== null && amountMinor <= maximum));
  });

  const sorted = [...matches];
  switch (query.sort) {
    case "name_asc":
      sorted.sort((left, right) => left.name.localeCompare(right.name, "en"));
      break;
    case "rarity":
      sorted.sort((left, right) => GAME_RARITIES.indexOf(left.rarity as typeof GAME_RARITIES[number])
        - GAME_RARITIES.indexOf(right.rarity as typeof GAME_RARITIES[number])
        || left.name.localeCompare(right.name, "en"));
      break;
    case "price_asc":
      sorted.sort((left, right) => comparePrices(left, right, 1));
      break;
    case "price_desc":
      sorted.sort((left, right) => comparePrices(left, right, -1));
      break;
    default:
      break;
  }

  const pageSize = Math.min(120, positiveInteger(query.pageSize, 24));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const requestedOffset = Number.isSafeInteger(query.offset) && Number(query.offset) >= 0
    ? Number(query.offset)
    : (positiveInteger(query.page, 1) - 1) * pageSize;
  const requestedPage = Math.floor(requestedOffset / pageSize) + 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const offset = (page - 1) * pageSize;
  const pageItems = sorted.slice(offset, offset + pageSize);
  const rangeStart = sorted.length ? offset + 1 : 0;
  const rangeEnd = sorted.length ? offset + pageItems.length : 0;

  return {
    items: pageItems,
    total: sorted.length,
    pagination: {
      page,
      pageSize,
      totalPages,
      total: sorted.length,
      rangeStart,
      rangeEnd,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
    facets: buildCatalogFacets(items),
  };
}

export function findCatalogSkins(items: CatalogSkin[], query: string, category: string, limit: number, offset: number) {
  const result = queryCatalog(items, {
    query,
    weaponCategory: category,
    pageSize: Math.min(Math.max(limit, 1), 120),
    offset: Math.max(offset, 0),
  });
  return { total: result.total, items: result.items };
}
