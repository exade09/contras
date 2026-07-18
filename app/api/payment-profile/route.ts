import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userPaymentProfiles } from "@/db/schema";
import { requireUser, routeError } from "@/lib/server/auth";
import {
  serializeUserPaymentProfile,
  validateUserPaymentProfile,
} from "@/lib/server/payment-profile";
import { jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await getDb().select().from(userPaymentProfiles)
      .where(eq(userPaymentProfiles.userId, user.id))
      .limit(1);
    return Response.json(
      { profile: rows[0] ? serializeUserPaymentProfile(rows[0]) : null },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    const validated = validateUserPaymentProfile(body);
    if (!validated.ok) return jsonError(validated.error);
    const now = new Date().toISOString();
    const values = {
      userId: user.id,
      ...validated.value,
      updatedByRole: "user" as const,
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
    const user = await requireUser(request);
    await getDb().delete(userPaymentProfiles).where(eq(userPaymentProfiles.userId, user.id));
    return Response.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return routeError(error);
  }
}
