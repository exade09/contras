import { and, count, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { loginEvents, users } from "@/db/schema";
import { constantTimeEqual, issueSession, routeError, sha256, verifyPassword } from "@/lib/server/auth";
import { validEnvironmentAdminCredentials } from "@/lib/server/security";
import { cleanText, jsonError, runtimeEnv, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const DUMMY_HASH = "0".repeat(64);

async function environmentAdminUser(login: string) {
  const db = getDb();
  const existing = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.login, login)).limit(1);
  if (existing[0]) {
    if (existing[0].role !== "admin") throw new Error("ADMIN_LOGIN conflicts with a non-administrator account.");
    return existing[0].id;
  }
  await db.insert(users).values({
    id: "env-admin", login, displayName: "Administrator", passwordHash: null, passwordSalt: null,
    role: "admin", status: "active", updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({ target: users.id, set: { login, displayName: "Administrator", role: "admin", status: "active", updatedAt: new Date().toISOString() } });
  return "env-admin";
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const body = await request.json().catch(() => null) as { login?: string; password?: string } | null;
    if (!body) return jsonError("Request body must be valid JSON");
    const login = cleanText(body.login, 64).toLocaleLowerCase("en-US");
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    if (!login || !password) return jsonError("Login and password are required");

    // Use the proxy-appended address rather than a client-prepended value.
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
    const ipHash = await sha256(ip);
    const db = getDb();
    const threshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const configuredAdminLogin = runtimeEnv().ADMIN_LOGIN?.trim().toLocaleLowerCase("en-US") || "";
    const configuredAdminPassword = runtimeEnv().ADMIN_PASSWORD || "";
    const hasAdminConfiguration = Boolean(configuredAdminLogin || configuredAdminPassword);
    if (hasAdminConfiguration && !validEnvironmentAdminCredentials(configuredAdminLogin, configuredAdminPassword)) {
      throw new Error("ADMIN_LOGIN and ADMIN_PASSWORD do not meet the secure configuration requirements.");
    }
    const adminCandidate = Boolean(hasAdminConfiguration && login === configuredAdminLogin);
    const suppliedDigest = await sha256(password);
    const adminValid = adminCandidate && constantTimeEqual(suppliedDigest, await sha256(configuredAdminPassword));
    const eventId = crypto.randomUUID();
    const attemptReserved = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${login}:${ipHash}`}, 0))`,
      );
      const recent = await transaction.select({ total: count() }).from(loginEvents).where(and(
        eq(loginEvents.login, login), eq(loginEvents.ipHash, ipHash), eq(loginEvents.success, false), gt(loginEvents.createdAt, threshold),
      ));
      if ((recent[0]?.total || 0) >= 10 && !adminValid) return false;
      await transaction.insert(loginEvents).values({
        id: eventId,
        login,
        ipHash,
        success: false,
        createdAt: new Date().toISOString(),
      });
      return true;
    });
    if (!attemptReserved) return jsonError("Too many attempts. Try again in 15 minutes.", 429);

    let userId = "";
    let role: "admin" | "user" = "user";
    let valid = false;
    if (adminValid) {
      userId = await environmentAdminUser(login);
      role = "admin";
      valid = true;
    } else {
      const rows = await db.select({ id: users.id, passwordHash: users.passwordHash, passwordSalt: users.passwordSalt, role: users.role, status: users.status })
        .from(users).where(eq(users.login, login)).limit(1);
      const account = rows[0];
      const passwordValid = account?.passwordHash && account.passwordSalt
        ? await verifyPassword(password, account.passwordSalt, account.passwordHash)
        : await verifyPassword(password, DUMMY_SALT, DUMMY_HASH);
      if (account && account.status === "active" && passwordValid) {
        userId = account.id; role = account.role === "admin" ? "admin" : "user"; valid = true;
      }
    }

    if (!valid) return jsonError("Incorrect login or password", 401);
    await db.update(loginEvents).set({ success: true }).where(eq(loginEvents.id, eventId));
    await db.update(users).set({ lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(users.id, userId));
    const response = Response.json({ ok: true, role });
    response.headers.append("set-cookie", await issueSession(request, userId));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
