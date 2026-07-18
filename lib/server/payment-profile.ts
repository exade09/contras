import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { userPaymentProfiles } from "@/db/schema";
import { runtimeEnv } from "./storage";

export const USER_PAYMENT_METHOD = "kaspi_card" as const;

export type UserPaymentProfile = {
  method: typeof USER_PAYMENT_METHOD;
  recipientName: string;
  kaspiPhone: string;
  cardLast4: string;
  hasCardNumber: boolean;
  cardMask: string;
  updatedByRole: "user" | "admin";
  updatedAt: string;
};

export type PaymentProfileValidation =
  | {
      ok: true;
      value: Pick<UserPaymentProfile, "method" | "recipientName" | "kaspiPhone" | "cardLast4"> & {
        cardNumber: string | null;
      };
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

function luhnValid(value: string) {
  let total = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    double = !double;
  }
  return total % 10 === 0;
}

export function normalizeCardNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || /[^0-9\s-]/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return null;
  return digits;
}

function encryptionKey(value = runtimeEnv().PAYMENT_DATA_ENCRYPTION_KEY) {
  const normalized = value?.trim() || "";
  let key: Buffer;
  try {
    key = Buffer.from(normalized, "base64url");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new Error("PAYMENT_DATA_ENCRYPTION_KEY must be a base64url-encoded 32-byte secret.");
  }
  return key;
}

function cardAad(userId: string) {
  return Buffer.from(`contras:payment-profile:${userId}`, "utf8");
}

export function encryptCardNumber(cardNumber: string, userId: string, keyValue?: string) {
  const normalized = normalizeCardNumber(cardNumber);
  if (!normalized) throw new Error("A valid card number is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  cipher.setAAD(cardAad(userId));
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const sealed = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${sealed.toString("base64url")}`;
}

export function decryptCardNumber(envelope: string, userId: string, keyValue?: string) {
  const [version, ivValue, sealedValue, extra] = envelope.split(".");
  if (version !== "v1" || !ivValue || !sealedValue || extra) throw new Error("Invalid card data envelope");
  const iv = Buffer.from(ivValue, "base64url");
  const sealed = Buffer.from(sealedValue, "base64url");
  if (iv.length !== 12 || sealed.length <= 16) throw new Error("Invalid card data envelope");
  const ciphertext = sealed.subarray(0, -16);
  const authTag = sealed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  decipher.setAAD(cardAad(userId));
  decipher.setAuthTag(authTag);
  const cardNumber = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  if (!normalizeCardNumber(cardNumber)) throw new Error("Decrypted card data is invalid");
  return cardNumber;
}

export function validateUserPaymentProfile(value: unknown, existingCardLast4 = ""): PaymentProfileValidation {
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
  const cardNumber = normalizeCardNumber(input.cardNumber);
  if (cardNumber === null) return { ok: false, error: "Enter a valid card number" };
  const cardLast4 = cardNumber ? cardNumber.slice(-4) : existingCardLast4;
  if (cardLast4 && !/^\d{4}$/.test(cardLast4)) return { ok: false, error: "Saved card reference is invalid" };
  if (!kaspiPhone && !cardLast4) {
    return { ok: false, error: "Enter a Kaspi phone or card number" };
  }

  return {
    ok: true,
    value: { method: USER_PAYMENT_METHOD, recipientName, kaspiPhone, cardLast4, cardNumber: cardNumber || null },
  };
}

export function serializeUserPaymentProfile(row: PaymentProfileRow): UserPaymentProfile {
  return {
    method: USER_PAYMENT_METHOD,
    recipientName: row.recipientName,
    kaspiPhone: row.kaspiPhone,
    cardLast4: row.cardLast4,
    hasCardNumber: Boolean(row.cardPanEncrypted),
    cardMask: row.cardLast4 ? `•••• ${row.cardLast4}` : "",
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
