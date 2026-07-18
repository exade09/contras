import type { userPaymentProfiles } from "@/db/schema";

export const USER_PAYMENT_METHOD = "kaspi_card" as const;

export type UserPaymentProfile = {
  method: typeof USER_PAYMENT_METHOD;
  recipientName: string;
  kaspiPhone: string;
  cardLast4: string;
  updatedByRole: "user" | "admin";
  updatedAt: string;
};

export type PaymentProfileValidation =
  | {
      ok: true;
      value: Pick<UserPaymentProfile, "method" | "recipientName" | "kaspiPhone" | "cardLast4">;
    }
  | { ok: false; error: string };

type PaymentProfileRow = typeof userPaymentProfiles.$inferSelect;

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function possibleFullCardNumber(value: string) {
  return (value.match(/(?:\d[ -]?){13,19}/g) || [])
    .some((candidate) => candidate.replace(/\D/g, "").length >= 13);
}

export function normalizeKaspiPhone(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[^0-9+()\s-]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length !== 11) return null;
  if (digits.startsWith("7")) return `+${digits}`;
  if (digits.startsWith("8")) return `+7${digits.slice(1)}`;
  return null;
}

export function validateUserPaymentProfile(value: unknown): PaymentProfileValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "A valid payment profile is required" };
  }
  const input = value as Record<string, unknown>;
  const recipientName = typeof input.recipientName === "string"
    ? input.recipientName.trim().replace(/\s+/g, " ")
    : "";
  if (!recipientName || recipientName.length > 80 || hasControlCharacters(recipientName)) {
    return { ok: false, error: "Recipient name must contain 1-80 characters" };
  }
  if (possibleFullCardNumber(recipientName)) {
    return { ok: false, error: "Do not enter a full card number" };
  }

  const kaspiPhone = normalizeKaspiPhone(input.kaspiPhone);
  if (kaspiPhone === null) {
    return { ok: false, error: "Enter a valid Kaspi phone number" };
  }
  const cardLast4 = typeof input.cardLast4 === "string" ? input.cardLast4.trim() : "";
  if (cardLast4 && !/^\d{4}$/.test(cardLast4)) {
    return { ok: false, error: "Card reference must contain exactly the last 4 digits" };
  }
  if (!kaspiPhone && !cardLast4) {
    return { ok: false, error: "Enter a Kaspi phone or the last 4 card digits" };
  }

  return {
    ok: true,
    value: { method: USER_PAYMENT_METHOD, recipientName, kaspiPhone, cardLast4 },
  };
}

export function serializeUserPaymentProfile(row: PaymentProfileRow): UserPaymentProfile {
  return {
    method: USER_PAYMENT_METHOD,
    recipientName: row.recipientName,
    kaspiPhone: row.kaspiPhone,
    cardLast4: row.cardLast4,
    updatedByRole: row.updatedByRole === "admin" ? "admin" : "user",
    updatedAt: row.updatedAt,
  };
}

export function formatUserPaymentProfile(profile: Pick<UserPaymentProfile, "recipientName" | "kaspiPhone" | "cardLast4">) {
  return [
    profile.recipientName,
    profile.kaspiPhone ? `Kaspi phone ${profile.kaspiPhone}` : "",
    profile.cardLast4 ? `card ending ${profile.cardLast4}` : "",
  ].filter(Boolean).join(" · ");
}
