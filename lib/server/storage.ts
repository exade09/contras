import { getDb } from "@/db";
import { mutationOriginAllowed, safeReturnPathValue } from "./security";

export type RuntimeEnv = {
  ADMIN_LOGIN?: string;
  ADMIN_PASSWORD?: string;
  CSGO_API_BASE_URL?: string;
  CSGO_API_CACHE_TTL_SECONDS?: string;
  SKINPORT_PRICE_CACHE_TTL_SECONDS?: string;
  SKINPORT_PRICE_CURRENCY?: string;
  DATABASE_CONNECT_TIMEOUT_SECONDS?: string;
  DATABASE_IDLE_TIMEOUT_SECONDS?: string;
  DATABASE_POOL_MAX?: string;
  DATABASE_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  SESSION_SECRET?: string;
  STEAM_API_KEY?: string;
  STEAMAPIS_API_KEY?: string;
};

export function runtimeEnv(): RuntimeEnv {
  return {
    ADMIN_LOGIN: process.env.ADMIN_LOGIN,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    CSGO_API_BASE_URL: process.env.CSGO_API_BASE_URL,
    CSGO_API_CACHE_TTL_SECONDS: process.env.CSGO_API_CACHE_TTL_SECONDS,
    SKINPORT_PRICE_CACHE_TTL_SECONDS: process.env.SKINPORT_PRICE_CACHE_TTL_SECONDS,
    SKINPORT_PRICE_CURRENCY: process.env.SKINPORT_PRICE_CURRENCY,
    DATABASE_CONNECT_TIMEOUT_SECONDS: process.env.DATABASE_CONNECT_TIMEOUT_SECONDS,
    DATABASE_IDLE_TIMEOUT_SECONDS: process.env.DATABASE_IDLE_TIMEOUT_SECONDS,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    STEAM_API_KEY: process.env.STEAM_API_KEY,
    STEAMAPIS_API_KEY: process.env.STEAMAPIS_API_KEY,
  };
}

/** Compatibility alias while route modules move from D1 calls to Drizzle. */
export const database = getDb;

/**
 * Database initialization is intentionally explicit through `npm run db:migrate`.
 * This no-op remains temporarily so older route modules do not run DDL at request time.
 */
export async function ensureSchema(): Promise<void> {
  return Promise.resolve();
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function parseHttpOrigin(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must contain only an HTTP(S) origin.`);
  }

  return url.origin;
}

/** Return the configured canonical origin, with request fallback only outside production. */
export function canonicalAppOrigin(request?: Request) {
  const configured = runtimeEnv().NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return parseHttpOrigin(configured, "NEXT_PUBLIC_APP_URL");

  if (request && process.env.NODE_ENV !== "production") {
    return parseHttpOrigin(new URL(request.url).origin, "Request origin");
  }

  throw new Error("NEXT_PUBLIC_APP_URL is required in production.");
}

export function sameOrigin(request: Request) {
  return mutationOriginAllowed(request, runtimeEnv().NEXT_PUBLIC_APP_URL);
}

export function safeReturnPath(value: unknown, fallback = "/") {
  return safeReturnPathValue(value, fallback);
}

export function cleanText(value: unknown, max: number) {
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return typeof value === "string" ? value.trim().slice(0, safeMax) : "";
}
