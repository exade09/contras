import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { deals, sessions, steamLinks, users } from "@/db/schema";
import { hashPassword, requireAdmin, routeError } from "@/lib/server/auth";
import { jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };
const LOGIN_PATTERN = /^[a-z0-9._-]{3,64}$/;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return null;
  return request.json().catch(() => null) as Promise<unknown>;
}

function requiredText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum && !normalized.includes("\u0000")
    ? normalized
    : null;
}

function hasOwn(record: JsonRecord, property: string) {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function postgresErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return postgresErrorCode(error.cause);
}

function responseJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const rows = await getDb()
      .select({
        id: users.id,
        login: users.login,
        display_name: users.displayName,
        role: users.role,
        status: users.status,
        steam_id: steamLinks.steamId,
        created_at: users.createdAt,
        last_login_at: users.lastLoginAt,
        deal_count: sql<number>`count(${deals.id})::integer`.mapWith(Number),
        deal_total: sql<number>`coalesce(sum(${deals.amountCents}), 0)::bigint`.mapWith(Number),
      })
      .from(users)
      .leftJoin(steamLinks, eq(steamLinks.userId, users.id))
      .leftJoin(deals, eq(deals.userId, users.id))
      .groupBy(
        users.id,
        users.login,
        users.displayName,
        users.role,
        users.status,
        users.createdAt,
        users.lastLoginAt,
        steamLinks.steamId,
      )
      .orderBy(desc(users.createdAt))
      .limit(200);

    return responseJson({ users: rows });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const body = await jsonBody(request);
    if (!isRecord(body)) return jsonError("A valid JSON request body is required", 400);

    const rawLogin = requiredText(body.login, 64);
    const login = rawLogin?.toLowerCase() || "";
    if (!LOGIN_PATTERN.test(login)) {
      return jsonError("Login must contain 3-64 Latin letters, numbers, dots, underscores or hyphens");
    }

    const displayName = requiredText(body.displayName, 80);
    if (!displayName) return jsonError("Display name must contain 1-80 characters");

    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) {
      return jsonError("Password must contain 10-128 characters");
    }

    if (body.role !== "user" && body.role !== "admin") {
      return jsonError("Role must be user or admin");
    }

    let password: Awaited<ReturnType<typeof hashPassword>>;
    try {
      password = await hashPassword(body.password);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotSupportedError") {
        return jsonError("Password hashing is temporarily unavailable", 503);
      }
      throw error;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await getDb().insert(users).values({
        id,
        login,
        displayName,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        role: body.role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (postgresErrorCode(error) === "23505") return jsonError("This login already exists", 409);
      throw error;
    }

    return responseJson({ user: { id, login, display_name: displayName, role: body.role, status: "active" } }, 201);
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const body = await jsonBody(request);
    if (!isRecord(body)) return jsonError("A valid JSON request body is required", 400);

    const id = requiredText(body.id, 64);
    if (!id) return jsonError("User id is required");

    const changes: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    let changed = false;
    let credentialsChanged = false;
    let nextStatus: "active" | "blocked" | undefined;

    if (hasOwn(body, "status")) {
      if (body.status !== "active" && body.status !== "blocked") {
        return jsonError("Status must be active or blocked");
      }
      nextStatus = body.status;
      changes.status = body.status;
      changed = true;
    }

    if (hasOwn(body, "displayName")) {
      const displayName = requiredText(body.displayName, 80);
      if (!displayName) return jsonError("Display name must contain 1-80 characters");
      changes.displayName = displayName;
      changed = true;
    }

    if (hasOwn(body, "password")) {
      if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) {
        return jsonError("Password must contain 10-128 characters");
      }
      let password: Awaited<ReturnType<typeof hashPassword>>;
      try {
        password = await hashPassword(body.password);
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotSupportedError") {
          return jsonError("Password hashing is temporarily unavailable", 503);
        }
        throw error;
      }
      changes.passwordHash = password.hash;
      changes.passwordSalt = password.salt;
      changed = true;
      credentialsChanged = true;
    }

    if (!changed) return jsonError("No supported user changes were provided");

    const updated = await getDb().transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!existing.length) return false;

      await transaction.update(users).set(changes).where(eq(users.id, id));
      if (nextStatus === "blocked" || credentialsChanged) {
        await transaction.delete(sessions).where(eq(sessions.userId, id));
      }
      return true;
    });

    if (!updated) return jsonError("User not found", 404);
    return responseJson({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
