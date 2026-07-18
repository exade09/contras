import { and, count, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentProfileAccessEvents, userPaymentProfiles } from "@/db/schema";
import { requireAdmin, routeError, sha256 } from "@/lib/server/auth";
import { decryptCardNumber } from "@/lib/server/payment-profile";
import { cleanText, jsonError, runtimeEnv, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };
const ADMIN_CARD_REVEALS_PER_MINUTE = 30;

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const admin = await requireAdmin(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const userId = cleanText(body?.userId, 64);
    if (!userId) return jsonError("User id is required");

    const threshold = new Date(Date.now() - 60_000).toISOString();
    const recentRows = await getDb().select({ total: count() }).from(paymentProfileAccessEvents)
      .where(and(
        eq(paymentProfileAccessEvents.actorUserId, admin.id),
        eq(paymentProfileAccessEvents.action, "reveal"),
        gt(paymentProfileAccessEvents.createdAt, threshold),
      ));
    if ((recentRows[0]?.total || 0) >= ADMIN_CARD_REVEALS_PER_MINUTE) {
      return jsonError("Too many card reveal requests. Try again in one minute.", 429);
    }

    const rows = await getDb().select({ encrypted: userPaymentProfiles.cardPanEncrypted })
      .from(userPaymentProfiles)
      .where(eq(userPaymentProfiles.userId, userId))
      .limit(1);
    const encrypted = rows[0]?.encrypted || "";
    if (!encrypted) return jsonError("No encrypted card number is saved for this user", 404);

    const cardNumber = decryptCardNumber(encrypted, userId);
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = forwarded || request.headers.get("x-real-ip") || "unknown";
    const ipHash = await sha256(`${runtimeEnv().SESSION_SECRET || ""}:${clientIp}`);
    await getDb().insert(paymentProfileAccessEvents).values({
      id: crypto.randomUUID(),
      actorUserId: admin.id,
      targetUserId: userId,
      action: "reveal",
      ipHash,
      createdAt: new Date().toISOString(),
    });

    return Response.json({ cardNumber }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return routeError(error);
  }
}
