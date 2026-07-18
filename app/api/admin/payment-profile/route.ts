import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userPaymentProfiles, users } from "@/db/schema";
import { requireAdmin, routeError } from "@/lib/server/auth";
import {
  encryptCardNumber,
  serializeUserPaymentProfile,
  validateUserPaymentProfile,
} from "@/lib/server/payment-profile";
import { cleanText, jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const userId = cleanText(body?.userId, 64);
    if (!userId) return jsonError("User id is required");
    const [existingUser, existingProfiles] = await Promise.all([
      getDb().select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
      getDb().select().from(userPaymentProfiles).where(eq(userPaymentProfiles.userId, userId)).limit(1),
    ]);
    if (!existingUser.length) return jsonError("User not found", 404);
    const existing = existingProfiles[0];
    const validated = validateUserPaymentProfile(body, existing?.cardLast4 || "");
    if (!validated.ok) return jsonError(validated.error);
    const { cardNumber, ...profileValues } = validated.value;

    const now = new Date().toISOString();
    const values = {
      userId,
      ...profileValues,
      cardPanEncrypted: cardNumber
        ? encryptCardNumber(cardNumber, userId)
        : existing?.cardPanEncrypted || "",
      updatedByRole: "admin" as const,
      updatedAt: now,
    };
    const rows = await getDb().insert(userPaymentProfiles).values({
      ...values,
      createdAt: now,
    }).onConflictDoUpdate({
      target: userPaymentProfiles.userId,
      set: values,
    }).returning();
    return Response.json(
      { profile: serializeUserPaymentProfile(rows[0]) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const userId = cleanText(body?.userId, 64);
    if (!userId) return jsonError("User id is required");
    await getDb().delete(userPaymentProfiles).where(eq(userPaymentProfiles.userId, userId));
    return Response.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return routeError(error);
  }
}
