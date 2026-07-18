export type CatalogFilterState = {
  q: string;
  itemType: string;
  weaponCategory: string;
  weapon: string;
  rarity: string;
  wear: string;
  sort: string;
  onlyWithPrices: boolean;
  page: number;
};

export function catalogPageWindow(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const values = new Set([1, 2, page - 1, page, page + 1, totalPages - 1, totalPages]);
  const sorted = Array.from(values).filter((value) => value > 0 && value <= totalPages).sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

export function updateCatalogFilter<Key extends keyof CatalogFilterState>(current: CatalogFilterState, key: Key, value: CatalogFilterState[Key]): CatalogFilterState {
  return { ...current, [key]: value, page: key === "page" ? Number(value) : 1 };
}

export function catalogSearchParams(filters: CatalogFilterState, pageSize = 36) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(pageSize), sort: filters.sort });
  (["q", "itemType", "weaponCategory", "weapon", "rarity", "wear"] as const).forEach((key) => {
    if (filters[key]) params.set(key, filters[key]);
  });
  params.set("onlyWithPrices", String(filters.onlyWithPrices));
  return params;
}

export type CatalogPriceViewInput = {
  status: "available" | "stale" | "unavailable" | "temporarily_unavailable";
  amountMinor: number | null;
  currency: string | null;
  updatedAt: string | null;
  stale: boolean;
};

export type CatalogPricePresentation = {
  amountLabel: string;
  sourceLabel: "Market price";
  updatedLabel: string | null;
  available: boolean;
  stale: boolean;
};

export function formatCurrencyMinorUnits(amountMinor: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / (10 ** digits));
  } catch {
    return `${currency} ${amountMinor}`;
  }
}

export function catalogPricePresentation(
  price: CatalogPriceViewInput,
  now = Date.now(),
): CatalogPricePresentation {
  const available = (price.status === "available" || price.status === "stale") &&
    price.amountMinor !== null && price.currency !== null;
  if (!available) {
    return {
      amountLabel: price.status === "temporarily_unavailable"
        ? "Price temporarily unavailable"
        : "Price unavailable",
      sourceLabel: "Market price",
      updatedLabel: null,
      available: false,
      stale: false,
    };
  }

  let updatedLabel: string | null = null;
  if (price.updatedAt) {
    const seconds = Math.max(0, Math.floor((now - new Date(price.updatedAt).getTime()) / 1_000));
    if (Number.isFinite(seconds)) {
      if (seconds < 60) updatedLabel = "Updated just now";
      else if (seconds < 3_600) updatedLabel = `Updated ${Math.floor(seconds / 60)} minutes ago`;
      else if (seconds < 86_400) updatedLabel = `Updated ${Math.floor(seconds / 3_600)} hours ago`;
      else {
        const days = Math.floor(seconds / 86_400);
        updatedLabel = `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
      }
    }
  }
  const stale = price.stale || price.status === "stale";
  return {
    amountLabel: formatCurrencyMinorUnits(price.amountMinor!, price.currency!),
    sourceLabel: "Market price",
    updatedLabel: updatedLabel ? `${updatedLabel}${stale ? " · Stale" : ""}` : stale ? "Stale" : null,
    available: true,
    stale,
  };
}
