import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { dealItems, deals } from "@/db/schema";
import { requireUser, routeError } from "@/lib/server/auth";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await getDb()
      .select({
        id: deals.id,
        deal_date: deals.dealDate,
        amount_cents: deals.amountCents,
        currency: deals.currency,
        status: deals.status,
        source: deals.source,
        note: deals.note,
        created_at: deals.createdAt,
        items: sql<string | null>`string_agg(${dealItems.name}, ${" · "} order by ${dealItems.id})`,
        item_count: sql<number>`count(${dealItems.id})::integer`.mapWith(Number),
      })
      .from(deals)
      .leftJoin(dealItems, eq(dealItems.dealId, deals.id))
      .where(eq(deals.userId, user.id))
      .groupBy(
        deals.id,
        deals.dealDate,
        deals.amountCents,
        deals.currency,
        deals.status,
        deals.source,
        deals.note,
        deals.createdAt,
      )
      .orderBy(desc(deals.dealDate), desc(deals.createdAt))
      .limit(200);

    return Response.json({ deals: rows }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return routeError(error);
  }
}
