import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("DATABASE_URL is not configured; skipping PostgreSQL migrations.");
  process.exit(0);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const migration = spawnSync(executable, ["drizzle-kit", "migrate"], {
  env: process.env,
  stdio: "inherit",
});

if (migration.error) throw migration.error;
process.exit(migration.status ?? 1);
