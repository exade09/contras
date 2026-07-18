import {
  type CatalogSort,
  loadCatalogSnapshot,
  queryCatalog,
} from "@/lib/server/skins";
import {
  attachCatalogPrices,
  configuredPriceCurrency,
  decimalToMinorUnits,
  loadCatalogPrices,
} from "@/lib/server/catalog-prices";

export const runtime = "nodejs";

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function optionalMinorUnits(url: URL, name: "minPrice" | "maxPrice", currency: string) {
  const explicitMinor = url.searchParams.get(`${name}Minor`);
  if (explicitMinor !== null) {
    const parsed = Number(explicitMinor);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  const decimal = url.searchParams.get(name);
  return decimal === null ? undefined : decimalToMinorUnits(decimal, currency) ?? undefined;
}

function catalogSort(value: string | null): CatalogSort {
  switch ((value || "").toLocaleLowerCase("en-US")) {
    case "name":
    case "name_asc":
    case "name-a-z":
      return "name_asc";
    case "rarity":
      return "rarity";
    case "price_asc":
    case "price-low-high":
      return "price_asc";
    case "price_desc":
    case "price-high-low":
      return "price_desc";
    default:
      return "default";
  }
}

function optionalFilter(url: URL, ...names: string[]) {
  for (const name of names) {
    const value = (url.searchParams.get(name) || "").trim().slice(0, 100);
    if (value) return value;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const currency = configuredPriceCurrency();
    const pageSize = boundedInteger(url.searchParams.get("pageSize") || url.searchParams.get("limit"), 24, 1, 120);
    const page = boundedInteger(url.searchParams.get("page"), 1, 1, 100_000);
    const offsetValue = url.searchParams.get("offset");
    const offset = offsetValue === null ? undefined : boundedInteger(offsetValue, 0, 0, 12_000_000);
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const snapshot = await loadCatalogSnapshot();
    const marketHashNames = snapshot.items
      .map((item) => item.marketHashName)
      .filter((value): value is string => Boolean(value));
    const priceBatch = await loadCatalogPrices(marketHashNames, currency);
    const pricedItems = attachCatalogPrices(snapshot.items, priceBatch);
    const requestedOnlyWithPrices = ["1", "true", "yes"].includes(
      (url.searchParams.get("onlyWithPrices") || "").toLocaleLowerCase("en-US"),
    );
    const filters = {
      query,
      itemType: optionalFilter(url, "itemType", "type"),
      weaponCategory: optionalFilter(url, "weaponCategory", "category"),
      weapon: optionalFilter(url, "weapon"),
      rarity: optionalFilter(url, "rarity"),
      wear: optionalFilter(url, "wear"),
      sort: catalogSort(url.searchParams.get("sort")),
      page,
      pageSize,
      offset,
      // Keep the public catalog usable during a provider outage even when the
      // normal view is restricted to market-priced variants.
      onlyWithPrices: requestedOnlyWithPrices &&
        priceBatch.status !== "unavailable" &&
        priceBatch.status !== "temporarily_unavailable",
      minPriceMinor: optionalMinorUnits(url, "minPrice", currency),
      maxPriceMinor: optionalMinorUnits(url, "maxPrice", currency),
    };
    const result = queryCatalog(pricedItems, filters);

    return Response.json({
      source: "CSGO-API",
      items: result.items,
      total: result.total,
      pagination: result.pagination,
      facets: result.facets,
      filters,
      catalog: {
        source: snapshot.source,
        fetchedAt: snapshot.fetchedAt,
        stale: snapshot.stale,
        errorCode: snapshot.errorCode,
      },
      pricing: {
        source: priceBatch.source,
        status: priceBatch.status,
        currency: priceBatch.currency,
        updatedAt: priceBatch.completedAt,
        cache: priceBatch.cache,
        configured: priceBatch.configured,
      },
      generatedAt: new Date().toISOString(),
    }, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    console.error("Skin catalog unavailable", error);
    return Response.json({ error: "The public catalog is temporarily unavailable" }, { status: 500 });
  }
}
