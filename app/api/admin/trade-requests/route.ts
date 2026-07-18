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
    } | null;
    const id = cleanText(body?.id, 64);
    if (!id || !isTradeRequestStatus(body?.status) || body.status === "cancelled") {
      return jsonError("Invalid request status");
    }
    const db = getDb();
    const rows = await db.select({ status: tradeRequests.status })
      .from(tradeRequests)
      .where(eq(tradeRequests.id, id))
      .limit(1);
    const current = rows[0];
    if (!current) return jsonError("Request not found", 404);
    if (!isTradeRequestStatus(current.status) ||
      !canAdminTransitionTradeRequest(current.status, body.status)) {
      return jsonError(
        `Request cannot move from ${current.status} to ${body.status}`,
        409,
      );
    }
    const updated = await db.update(tradeRequests).set({
      status: body.status,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(tradeRequests.id, id),
      eq(tradeRequests.status, current.status),
    )).returning({ id: tradeRequests.id });
    if (!updated.length) {
      return jsonError("Request status changed. Refresh and try again.", 409);
    }
    return Response.json(
      { ok: true, status: body.status },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
