import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: databaseUrl ? { url: databaseUrl } : undefined,
});
