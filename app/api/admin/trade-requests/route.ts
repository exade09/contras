import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import { tradeRequestItems, tradeRequests, users } from "@/db/schema";
import { requireAdmin, routeError } from "@/lib/server/auth";
import {
  decodePaymentNote,
  encodePaymentNote,
  isPaymentMethod,
  validatePaymentDetails,
} from "@/lib/server/payment-details";
import {
  canAdminTransitionTradeRequest,
  groupTradeRequests,
  isTradeRequestStatus,
  serializeTradeRequest,
  serializeTradeRequestItem,
} from "@/lib/server/trade-requests";
import { cleanText, jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

async function allRequests() {
  const db = getDb();
  const requests = await db.select({
    ...getTableColumns(tradeRequests),
    login: users.login,
    displayName: users.displayName,
  }).from(tradeRequests)
    .leftJoin(users, eq(users.id, tradeRequests.userId))
    .orderBy(
      sql`case ${tradeRequests.status}
        when 'pending' then 0
        when 'contacted' then 1
        when 'accepted' then 2
        else 3 end`,
      desc(tradeRequests.createdAt),
    )
    .limit(100);
  if (!requests.length) return [];
  const items = await db.select().from(tradeRequestItems)
    .where(inArray(
      tradeRequestItems.requestId,
      requests.map((request) => request.id),
    ))
    .orderBy(tradeRequestItems.createdAt);
  return groupTradeRequests(
    requests.map(serializeTradeRequest),
    items.map(serializeTradeRequestItem),
  );
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(
      { requests: await allRequests() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const body = await request.json().catch(() => null) as {
      id?: unknown;
      status?: unknown;
      paymentMethod?: unknown;
      paymentDetails?: unknown;
    } | null;
    const id = cleanText(body?.id, 64);
    const hasPaymentUpdate = Boolean(body) && (
      Object.prototype.hasOwnProperty.call(body, "paymentMethod") ||
      Object.prototype.hasOwnProperty.call(body, "paymentDetails")
    );
    const hasStatusUpdate = body?.status !== undefined;
    if (!id || (!hasStatusUpdate && !hasPaymentUpdate)) {
      return jsonError("Invalid request status");
    }
    if (hasStatusUpdate && (!isTradeRequestStatus(body?.status) || body.status === "cancelled")) {
      return jsonError("Invalid request status");
    }
    const db = getDb();
    const rows = await db.select({
      status: tradeRequests.status,
      note: tradeRequests.note,
    })
      .from(tradeRequests)
      .where(eq(tradeRequests.id, id))
      .limit(1);
    const current = rows[0];
    if (!current) return jsonError("Request not found", 404);
    if (!isTradeRequestStatus(current.status)) {
      return jsonError("Request has an invalid current status", 409);
    }
    if (hasStatusUpdate && isTradeRequestStatus(body?.status) &&
      !canAdminTransitionTradeRequest(current.status, body.status)) {
      return jsonError(
        `Request cannot move from ${current.status} to ${body.status}`,
        409,
      );
    }

    const existingPayment = decodePaymentNote(current.note);
    let paymentMethod = existingPayment.paymentMethod;
    let paymentDetails = existingPayment.paymentDetails;
    if (hasPaymentUpdate) {
      if (Object.prototype.hasOwnProperty.call(body, "paymentMethod")) {
        const candidate = body?.paymentMethod;
        if (candidate === "" || candidate === null) paymentMethod = null;
        else if (isPaymentMethod(candidate)) paymentMethod = candidate;
        else return jsonError("Payment method must be Kaspi Bank card");
      }
      if (Object.prototype.hasOwnProperty.call(body, "paymentDetails")) {
        const validated = validatePaymentDetails(body?.paymentDetails);
        if (!validated.ok) return jsonError(validated.error);
        paymentDetails = validated.value;
      }
      if (paymentDetails && !paymentMethod) {
        return jsonError("Select a payment method before adding payout details");
      }
    }

    const nextStatus = hasStatusUpdate && isTradeRequestStatus(body?.status)
      ? body.status
      : current.status;
    const updated = await db.update(tradeRequests).set({
      status: nextStatus,
      note: encodePaymentNote(existingPayment.note, paymentMethod, paymentDetails),
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(tradeRequests.id, id),
      eq(tradeRequests.status, current.status),
    )).returning({ id: tradeRequests.id });
    if (!updated.length) {
      return jsonError("Request status changed. Refresh and try again.", 409);
    }
    return Response.json(
      { ok: true, status: nextStatus },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
