import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type SqlClient = ReturnType<typeof postgres>;

type DatabaseCache = {
  url: string;
  client: SqlClient;
  db: Database;
};

const globalDatabase = globalThis as typeof globalThis & {
  __contrasDatabase?: DatabaseCache;
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is required. Configure a PostgreSQL connection before using database-backed features.",
    );
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error();
    if (!url.hostname || !url.pathname || url.pathname === "/") throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  return value;
}

function createDatabase(url: string): DatabaseCache {
  const client = postgres(url, {
    // A module singleton and a deliberately small pool avoid connection storms
    // when Vercel starts several functions concurrently.
    max: positiveInteger(process.env.DATABASE_POOL_MAX, 1, 10),
    idle_timeout: positiveInteger(process.env.DATABASE_IDLE_TIMEOUT_SECONDS, 20, 300),
    connect_timeout: positiveInteger(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS, 10, 60),
    prepare: false,
  });

  return { url, client, db: drizzle(client, { schema }) };
}

function cachedDatabase() {
  const url = databaseUrl();
  const cached = globalDatabase.__contrasDatabase;
  if (cached?.url === url) return cached;

  if (cached) {
    // Environment URLs should not change in a running deployment. During local
    // hot reload, close an obsolete pool without delaying the next request.
    void cached.client.end({ timeout: 1 });
  }

  const next = createDatabase(url);
  globalDatabase.__contrasDatabase = next;
  return next;
}

/** Lazily create and return the typed Drizzle database. */
export function getDb(): Database {
  return cachedDatabase().db;
}

/** Access the underlying postgres-js client for migrations and health checks. */
export function getSqlClient(): SqlClient {
  return cachedDatabase().client;
}

/** Close the cached pool, primarily for command-line tools and deterministic tests. */
export async function closeDb() {
  const cached = globalDatabase.__contrasDatabase;
  if (!cached) return;
  delete globalDatabase.__contrasDatabase;
  await cached.client.end({ timeout: 5 });
}

export { schema };
export * from "./schema";
