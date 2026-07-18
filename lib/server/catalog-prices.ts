export const SKINPORT_SOURCE = "Skinport" as const;
export const SKINPORT_ITEMS_ENDPOINT = "https://api.skinport.com/v1/items";

export type PriceBatchStatus = "available" | "partial" | "unavailable" | "temporarily_unavailable";
export type PriceCacheState = "hit" | "miss" | "stale";
export type CatalogPriceStatus = "available" | "stale" | "unavailable" | "temporarily_unavailable";

export type CatalogPriceRecord = {
  marketHashName: string;
  amountMinor: number;
  currency: string;
  updatedAt: string | null;
};

export type PriceProviderBatch = {
  source: typeof SKINPORT_SOURCE;
  status: PriceBatchStatus;
  currency: string;
  prices: CatalogPriceRecord[];
  requestedAt: string;
  completedAt: string;
  reason?: string;
  configured: boolean;
};

export type CachedPriceBatch = PriceProviderBatch & {
  cache: PriceCacheState;
  cacheStale: boolean;
};

export type CatalogPriceView = {
  status: CatalogPriceStatus;
  amountMinor: number | null;
  currency: string | null;
  source: typeof SKINPORT_SOURCE;
  updatedAt: string | null;
  stale: boolean;
};

export type PriceRecordInput = {
  marketHashName?: unknown;
  amountMinor?: unknown;
  currency?: unknown;
  updatedAt?: unknown;
};

export interface CatalogPriceProvider {
  readonly id: string;
  readonly configured: boolean;
  getPrices(marketHashNames: readonly string[], currency: string): Promise<PriceProviderBatch>;
}

type PriceCacheOptions = {
  ttlMs?: number;
  staleWhileRevalidateMs?: number;
  now?: () => number;
};

type PriceCacheEntry = {
  batch: PriceProviderBatch;
  freshUntil: number;
  staleUntil: number;
};

function environment(): Record<string, string | undefined> {
  return typeof process !== "undefined" ? process.env : {};
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanMarketHashName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 512) : "";
}

export function validateCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    if (typeof Intl.supportedValuesOf === "function" && !Intl.supportedValuesOf("currency").includes(currency)) return null;
    new Intl.NumberFormat("en", { style: "currency", currency }).format(1);
    return currency;
  } catch {
    return null;
  }
}

export function configuredPriceCurrency(value = environment().SKINPORT_PRICE_CURRENCY) {
  return validateCurrency(value) || "USD";
}

export function currencyMinorDigits(currency: string) {
  const normalized = validateCurrency(currency);
  if (!normalized) return null;
  const options = new Intl.NumberFormat("en", { style: "currency", currency: normalized }).resolvedOptions();
  return typeof options.maximumFractionDigits === "number" ? options.maximumFractionDigits : null;
}

export function decimalToMinorUnits(value: string, currency: string) {
  const digits = currencyMinorDigits(currency);
  if (digits === null || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  if (fraction.length > digits) return null;
  const scale = BigInt(10) ** BigInt(digits);
  const minor = BigInt(match[1]) * scale + BigInt((fraction + "0".repeat(digits)).slice(0, digits) || "0");
  if (minor <= BigInt(0) || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

function normalizeTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizePriceRecord(input: PriceRecordInput): CatalogPriceRecord | null {
  const marketHashName = cleanMarketHashName(input.marketHashName);
  const amountMinor = Number(input.amountMinor);
  const currency = validateCurrency(input.currency);
  if (!marketHashName || !currency || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const updatedAt = normalizeTimestamp(input.updatedAt);
  if (input.updatedAt !== null && input.updatedAt !== undefined && input.updatedAt !== "" && !updatedAt) return null;
  return { marketHashName, amountMinor, currency, updatedAt };
}

function normalizeNames(values: readonly string[]) {
  return Array.from(new Set(values.map(cleanMarketHashName).filter(Boolean))).sort((left, right) => left.localeCompare(right, "en"));
}

function hashKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function priceCacheKey(provider: CatalogPriceProvider, marketHashNames: readonly string[], currency: string) {
  return `${provider.id}:${currency}:${marketHashNames.length}:${hashKey(marketHashNames.join("\u0000"))}`;
}

function normalizeBatch(batch: PriceProviderBatch, currency: string, configured: boolean): PriceProviderBatch {
  const normalizedCurrency = validateCurrency(batch.currency) || currency;
  const prices = Array.isArray(batch.prices)
    ? batch.prices
      .map((record) => normalizePriceRecord(record))
      .filter((record): record is CatalogPriceRecord => record !== null)
      .filter((record) => record.currency === normalizedCurrency)
    : [];
  const requestedAt = normalizeTimestamp(batch.requestedAt) || new Date().toISOString();
  const completedAt = normalizeTimestamp(batch.completedAt) || requestedAt;
  const allowedStatus: PriceBatchStatus[] = ["available", "partial", "unavailable", "temporarily_unavailable"];
  const status = allowedStatus.includes(batch.status) ? batch.status : "temporarily_unavailable";
  return {
    source: SKINPORT_SOURCE,
    status,
    currency: normalizedCurrency,
    prices,
    requestedAt,
    completedAt,
    reason: typeof batch.reason === "string" ? batch.reason.slice(0, 240) : undefined,
    configured,
  };
}

export class UnavailableCatalogPriceProvider implements CatalogPriceProvider {
  readonly id: string;
  readonly configured: boolean;
  private readonly reason: string;

  constructor(options: { id?: string; configured?: boolean; reason?: string } = {}) {
    this.id = options.id || "skinport-unavailable";
    this.configured = Boolean(options.configured);
    this.reason = options.reason || "Skinport pricing is unavailable";
  }

  async getPrices(_marketHashNames: readonly string[], currency: string): Promise<PriceProviderBatch> {
    const now = new Date().toISOString();
    return {
      source: SKINPORT_SOURCE,
      status: "unavailable",
      currency: validateCurrency(currency) || "USD",
      prices: [],
      requestedAt: now,
      completedAt: now,
      reason: this.reason,
      configured: this.configured,
    };
  }
}

export class MockCatalogPriceProvider implements CatalogPriceProvider {
  readonly id: string;
  readonly configured = true;
  private readonly records: CatalogPriceRecord[];
  private readonly status: PriceBatchStatus;
  private readonly reason?: string;
  calls = 0;

  constructor(records: PriceRecordInput[], options: { id?: string; status?: PriceBatchStatus; reason?: string } = {}) {
    this.id = options.id || "skinport-mock";
    this.records = records.map(normalizePriceRecord).filter((record): record is CatalogPriceRecord => Boolean(record));
    this.status = options.status || "available";
    this.reason = options.reason;
  }

  async getPrices(marketHashNames: readonly string[], currency: string): Promise<PriceProviderBatch> {
    this.calls += 1;
    const requestedAt = new Date().toISOString();
    const requested = new Set(marketHashNames);
    const normalizedCurrency = validateCurrency(currency) || "USD";
    const prices = this.records.filter((record) => requested.has(record.marketHashName) && record.currency === normalizedCurrency);
    const status = this.status === "available" && prices.length < requested.size ? "partial" : this.status;
    return {
      source: SKINPORT_SOURCE,
      status,
      currency: normalizedCurrency,
      prices,
      requestedAt,
      completedAt: new Date().toISOString(),
      reason: this.reason,
      configured: true,
    };
  }
}

type SkinportFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SkinportProviderOptions = {
  endpoint?: string;
  fetchImpl?: SkinportFetchLike;
  timeoutMs?: number;
  now?: () => number;
};

const SKINPORT_CURRENCIES = new Set([
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HRK", "NOK", "PLN", "RUB", "SEK", "TRY", "USD",
]);

function skinportMinorUnits(value: unknown, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const digits = currencyMinorDigits(currency);
  if (digits === null) return null;
  const amount = Math.round(value * (10 ** digits));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function skinportTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return normalizeTimestamp(value * 1_000);
}

/** Public, documented Skinport market-price feed. No API key is required. */
export class SkinportCatalogPriceProvider implements CatalogPriceProvider {
  readonly id = "skinport-items-v1";
  readonly configured = true;
  private readonly endpoint: string;
  private readonly fetchImpl: SkinportFetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: SkinportProviderOptions = {}) {
    this.endpoint = options.endpoint || SKINPORT_ITEMS_ENDPOINT;
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = positiveInteger(options.timeoutMs, 12_000);
    this.now = options.now || Date.now;
  }

  async getPrices(marketHashNames: readonly string[], requestedCurrency: string): Promise<PriceProviderBatch> {
    const requestedAt = new Date(this.now()).toISOString();
    const currency = validateCurrency(requestedCurrency) || "USD";
    if (!SKINPORT_CURRENCIES.has(currency)) {
      return {
        source: SKINPORT_SOURCE,
        status: "unavailable",
        currency,
        prices: [],
        requestedAt,
        completedAt: requestedAt,
        reason: `Skinport does not support ${currency}`,
        configured: true,
      };
    }

    const requested = new Set(normalizeNames(marketHashNames));
    const endpoint = new URL(this.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.origin !== "https://api.skinport.com") {
      throw new Error("Skinport price endpoint must use the official HTTPS origin");
    }
    endpoint.search = new URLSearchParams({
      app_id: "730",
      currency,
      tradable: "0",
    }).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          "accept-encoding": "br",
          "user-agent": "contras.fun catalog pricing",
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Skinport pricing returned HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 64 * 1024 * 1024) throw new Error("Skinport pricing response is too large");
      const payload = JSON.parse(body) as unknown;
      if (!Array.isArray(payload)) throw new Error("Skinport pricing response has an invalid schema");

      const prices: CatalogPriceRecord[] = [];
      for (const entry of payload) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const marketHashName = cleanMarketHashName(record.market_hash_name);
        if (!requested.has(marketHashName) || validateCurrency(record.currency) !== currency) continue;
        const amountMinor = skinportMinorUnits(record.min_price, currency)
          ?? skinportMinorUnits(record.suggested_price, currency);
        if (!amountMinor) continue;
        prices.push({
          marketHashName,
          amountMinor,
          currency,
          updatedAt: skinportTimestamp(record.updated_at),
        });
      }

      return {
        source: SKINPORT_SOURCE,
        status: prices.length === requested.size ? "available" : "partial",
        currency,
        prices,
        requestedAt,
        completedAt: new Date(this.now()).toISOString(),
        reason: prices.length === requested.size
          ? undefined
          : "Some catalog variants do not have an exact Skinport market price",
        configured: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createProductionCatalogPriceProvider(options: SkinportProviderOptions = {}) {
  return new SkinportCatalogPriceProvider(options);
}

export class CatalogPriceCache {
  private readonly entries = new Map<string, PriceCacheEntry>();
  private readonly pending = new Map<string, Promise<PriceProviderBatch>>();
  private readonly ttlMs: number;
  private readonly staleWhileRevalidateMs: number;
  private readonly now: () => number;

  constructor(options: PriceCacheOptions = {}) {
    this.ttlMs = positiveInteger(options.ttlMs, 5 * 60 * 1000);
    this.staleWhileRevalidateMs = positiveInteger(options.staleWhileRevalidateMs, 30 * 60 * 1000);
    this.now = options.now || Date.now;
  }

  private async refresh(
    key: string,
    provider: CatalogPriceProvider,
    marketHashNames: readonly string[],
    currency: string,
  ) {
    const current = this.pending.get(key);
    if (current) return current;
    const request = provider.getPrices(marketHashNames, currency)
      .then((batch) => normalizeBatch(batch, currency, provider.configured))
      .then((batch) => {
        const loadedAt = this.now();
        this.entries.set(key, {
          batch,
          freshUntil: loadedAt + this.ttlMs,
          staleUntil: loadedAt + this.ttlMs + this.staleWhileRevalidateMs,
        });
        return batch;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  async get(provider: CatalogPriceProvider, names: readonly string[], requestedCurrency: string): Promise<CachedPriceBatch> {
    const currency = validateCurrency(requestedCurrency) || "USD";
    const marketHashNames = normalizeNames(names);
    const key = priceCacheKey(provider, marketHashNames, currency);
    const entry = this.entries.get(key);
    const now = this.now();

    if (entry && entry.freshUntil > now) return { ...entry.batch, cache: "hit", cacheStale: false };
    if (entry && entry.staleUntil > now) {
      void this.refresh(key, provider, marketHashNames, currency).catch(() => undefined);
      return { ...entry.batch, cache: "stale", cacheStale: true };
    }
    try {
      const batch = await this.refresh(key, provider, marketHashNames, currency);
      return { ...batch, cache: "miss", cacheStale: false };
    } catch {
      if (entry) return { ...entry.batch, cache: "stale", cacheStale: true };
      const timestamp = new Date(now).toISOString();
      return {
        source: SKINPORT_SOURCE,
        status: "temporarily_unavailable",
        currency,
        prices: [],
        requestedAt: timestamp,
        completedAt: timestamp,
        reason: "Skinport pricing is temporarily unavailable",
        configured: provider.configured,
        cache: "miss",
        cacheStale: false,
      };
    }
  }
}

function missingPriceStatus(batch: PriceProviderBatch): CatalogPriceStatus {
  return batch.status === "temporarily_unavailable" ? "temporarily_unavailable" : "unavailable";
}

export function attachCatalogPrices<
  T extends { marketHashName: string | null },
>(items: readonly T[], batch: CachedPriceBatch, options: { now?: number; staleAfterMs?: number } = {}) {
  const now = options.now ?? Date.now();
  const staleAfterMs = positiveInteger(options.staleAfterMs, 30 * 60 * 1000);
  const exactPrices = new Map<string, CatalogPriceRecord>();
  for (const candidate of batch.prices) {
    const price = normalizePriceRecord(candidate);
    if (price) exactPrices.set(price.marketHashName, price);
  }

  return items.map((item) => {
    const price = item.marketHashName ? exactPrices.get(item.marketHashName) : undefined;
    if (!price) {
      const state: CatalogPriceView = {
        status: missingPriceStatus(batch),
        amountMinor: null,
        currency: null,
        source: SKINPORT_SOURCE,
        updatedAt: null,
        stale: false,
      };
      return { ...item, price: state };
    }
    const timestamp = price.updatedAt ? Date.parse(price.updatedAt) : NaN;
    const stale = batch.cacheStale || (Number.isFinite(timestamp) && now - timestamp > staleAfterMs);
    const state: CatalogPriceView = {
      status: stale ? "stale" : "available",
      amountMinor: price.amountMinor,
      currency: price.currency,
      source: SKINPORT_SOURCE,
      updatedAt: price.updatedAt,
      stale,
    };
    return { ...item, price: state };
  });
}

const priceTtlSeconds = positiveInteger(environment().SKINPORT_PRICE_CACHE_TTL_SECONDS, 300);
const productionPriceProvider = createProductionCatalogPriceProvider();
const productionPriceCache = new CatalogPriceCache({ ttlMs: priceTtlSeconds * 1_000 });

export function loadCatalogPrices(marketHashNames: readonly string[], currency = configuredPriceCurrency()) {
  return productionPriceCache.get(productionPriceProvider, marketHashNames, currency);
}
