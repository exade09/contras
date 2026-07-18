import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { dealItems, deals, users } from "@/db/schema";
import { requireAdmin, routeError } from "@/lib/server/auth";
import {
  decodePaymentNote,
  encodePaymentNote,
  isPaymentMethod,
  validatePaymentDetails,
} from "@/lib/server/payment-details";
import { jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store, max-age=0" };
const CURRENCIES = ["USD", "EUR", "RUB"] as const;
const DEAL_STATUSES = ["completed", "pending", "cancelled"] as const;
const MAX_AMOUNT_MINOR = BigInt(1_000_000_000);

type JsonRecord = Record<string, unknown>;
type Currency = (typeof CURRENCIES)[number];
type DealStatus = (typeof DEAL_STATUSES)[number];
type ParsedDealItem = {
  id: string;
  name: string;
  quantity: number;
  priceCents: number;
};

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

function optionalText(value: unknown, maximum: number) {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximum && !normalized.includes("\u0000") ? normalized : null;
}

function currency(value: unknown): Currency | null {
  return CURRENCIES.find((candidate) => candidate === value) || null;
}

function dealStatus(value: unknown): DealStatus | null {
  return DEAL_STATUSES.find((candidate) => candidate === value) || null;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : null;
}

function decimalMinorUnits(value: unknown, maximum = MAX_AMOUNT_MINOR) {
  let text: string;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else return null;

  const match = text.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const fraction = (match[2] || "").padEnd(2, "0");
  const minor = BigInt(match[1]) * BigInt(100) + BigInt(fraction || "0");
  return minor <= maximum ? Number(minor) : null;
}

function parseItems(value: unknown): ParsedDealItem[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return null;

  const parsed: ParsedDealItem[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const name = requiredText(candidate.name, 180);
    if (!name) return null;

    const quantityValue = candidate.quantity === undefined ? 1 : candidate.quantity;
    if (typeof quantityValue !== "number" || !Number.isInteger(quantityValue) || quantityValue < 1 || quantityValue > 99) {
      return null;
    }

    const priceCents = candidate.price === undefined ? 0 : decimalMinorUnits(candidate.price);
    if (priceCents === null) return null;
    parsed.push({ id: crypto.randomUUID(), name, quantity: quantityValue, priceCents });
  }
  return parsed;
}

function responseJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const rows = await getDb()
      .select({
        id: deals.id,
        user_id: deals.userId,
        deal_date: deals.dealDate,
        amount_cents: deals.amountCents,
        currency: deals.currency,
        status: deals.status,
        source: deals.source,
        note: deals.note,
        created_at: deals.createdAt,
        login: users.login,
        display_name: users.displayName,
        items: sql<string | null>`string_agg(${dealItems.name}, ${" · "} order by ${dealItems.id})`,
      })
      .from(deals)
      .innerJoin(users, eq(users.id, deals.userId))
      .leftJoin(dealItems, eq(dealItems.dealId, deals.id))
      .groupBy(
        deals.id,
        deals.userId,
        deals.dealDate,
        deals.amountCents,
        deals.currency,
        deals.status,
        deals.source,
        deals.note,
        deals.createdAt,
        users.login,
        users.displayName,
      )
      .orderBy(desc(deals.dealDate), desc(deals.createdAt))
      .limit(300);

    return responseJson({
      deals: rows.map((row) => {
        const payment = decodePaymentNote(row.note);
        return {
          ...row,
          note: payment.note,
          payment_method: payment.paymentMethod,
          payment_details: payment.paymentDetails,
        };
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const admin = await requireAdmin(request);
    const body = await jsonBody(request);
    if (!isRecord(body)) return jsonError("A valid JSON request body is required", 400);

    const userId = requiredText(body.userId, 64);
    if (!userId) return jsonError("User id is required");

    const dealDate = validDate(body.dealDate);
    if (!dealDate) return jsonError("Deal date must be a valid YYYY-MM-DD date");

    const amountCents = decimalMinorUnits(body.amount);
    if (amountCents === null) return jsonError("Amount must be between 0.00 and 10000000.00 with at most two decimal places");

    const selectedCurrency = currency(body.currency);
    if (!selectedCurrency) return jsonError("Currency must be USD, EUR or RUB");

    const selectedStatus = dealStatus(body.status);
    if (!selectedStatus) return jsonError("Status must be completed, pending or cancelled");

    const note = optionalText(body.note, 500);
    if (note === null) return jsonError("Note must contain at most 500 characters");

    const paymentMethod = body.paymentMethod === "" || body.paymentMethod === null
      || body.paymentMethod === undefined
      ? null
      : isPaymentMethod(body.paymentMethod) ? body.paymentMethod : undefined;
    if (paymentMethod === undefined) return jsonError("Payment method must be Kaspi Bank card");
    const paymentDetails = validatePaymentDetails(body.paymentDetails);
    if (!paymentDetails.ok) return jsonError(paymentDetails.error);
    if (paymentDetails.value && !paymentMethod) {
      return jsonError("Select a payment method before adding payout details");
    }

    const items = parseItems(body.items);
    if (!items) return jsonError("Items must contain at most 50 valid entries with quantity 1-99 and non-negative prices");

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await getDb().transaction(async (transaction) => {
      const target = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target.length) return false;

      await transaction.insert(deals).values({
        id,
        userId,
        dealDate,
        amountCents,
        currency: selectedCurrency,
        status: selectedStatus,
        source: "manual",
        note: encodePaymentNote(note, paymentMethod, paymentDetails.value),
        createdBy: admin.id,
        createdAt: now,
      });
      if (items.length) {
        await transaction.insert(dealItems).values(items.map((item) => ({
          id: item.id,
          dealId: id,
          name: item.name,
          quantity: item.quantity,
          priceCents: item.priceCents,
        })));
      }
      return true;
    });

    if (!created) return jsonError("User not found", 404);
    return responseJson({ deal: { id } }, 201);
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    await requireAdmin(request);
    const id = requiredText(new URL(request.url).searchParams.get("id"), 64);
    if (!id) return jsonError("Deal id is required");

    const deleted = await getDb().transaction(async (transaction) => {
      await transaction.delete(dealItems).where(eq(dealItems.dealId, id));
      return transaction.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
    });
    if (!deleted.length) return jsonError("Deal not found", 404);
    return responseJson({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
