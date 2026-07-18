import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { steamLinks, users } from "@/db/schema";
import { requireUser, routeError } from "@/lib/server/auth";
import { clearSteamInventoryCache } from "@/lib/server/steam-inventory";
import { jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const user = await requireUser(request);
    const db = getDb();
    const accountRows = await db.select({
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      legacySteamId: users.steamId,
      linkedSteamId: steamLinks.steamId,
    }).from(users)
      .leftJoin(steamLinks, eq(steamLinks.userId, users.id))
      .where(eq(users.id, user.id))
      .limit(1);
    const account = accountRows[0];
    if (!account) return jsonError("Account not found", 404);
    if (!account.passwordHash || !account.passwordSalt) {
      return jsonError(
        "Steam is your only sign-in method and cannot be disconnected.",
        409,
      );
    }

    await db.transaction(async (transaction) => {
      await transaction.delete(steamLinks).where(eq(steamLinks.userId, user.id));
      await transaction.update(users).set({
        steamId: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, user.id));
    });
    clearSteamInventoryCache(account.linkedSteamId || account.legacySteamId || undefined);
    return Response.json(
      { ok: true, connected: false },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
