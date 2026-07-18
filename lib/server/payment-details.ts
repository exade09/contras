const PAYMENT_NOTE_PREFIX = "[[CONTRAS_PAYMENT_V1:";
const PAYMENT_NOTE_PATTERN = /^\[\[CONTRAS_PAYMENT_V1:([A-Za-z0-9_-]+)\]\](?:\r?\n)?/;

export const PAYMENT_METHODS = ["kaspi_card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentMetadata = {
  note: string;
  paymentMethod: PaymentMethod | null;
  paymentDetails: string;
};

export type PaymentDetailsValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" &&
    (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function paymentMethodLabel(method: PaymentMethod | null) {
  return method === "kaspi_card" ? "Kaspi Bank card" : null;
}

/**
 * Payout references may contain a recipient name, Kaspi phone, or last four
 * card digits. Full card numbers and authentication secrets are deliberately
 * rejected because this application is not a payment processor.
 */
export function validatePaymentDetails(value: unknown): PaymentDetailsValidation {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Payment details must be text" };
  }
  const normalized = value.trim();
  if (normalized.length > 240 || normalized.includes("\u0000")) {
    return { ok: false, error: "Payment details must contain at most 240 characters" };
  }
  if (/\b(?:cvv|cvc|pin|expiry|expiration|security\s+code)\b/i.test(normalized)) {
    return {
      ok: false,
      error: "Do not enter a CVV, PIN, expiry date, or security code",
    };
  }
  const possibleCardNumbers = normalized.match(/(?:\d[ -]?){13,19}/g) || [];
  if (possibleCardNumbers.some((candidate) => candidate.replace(/\D/g, "").length >= 13)) {
    return {
      ok: false,
      error: "Do not enter a full card number; use a Kaspi phone or last four digits",
    };
  }
  return { ok: true, value: normalized };
}

export function decodePaymentNote(value: string): PaymentMetadata {
  const match = value.match(PAYMENT_NOTE_PATTERN);
  if (!match) return { note: value, paymentMethod: null, paymentDetails: "" };
  try {
    const metadata = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as {
      method?: unknown;
      details?: unknown;
    };
    if (!isPaymentMethod(metadata.method) || typeof metadata.details !== "string") {
      return { note: value, paymentMethod: null, paymentDetails: "" };
    }
    return {
      note: value.slice(match[0].length),
      paymentMethod: metadata.method,
      paymentDetails: metadata.details,
    };
  } catch {
    return { note: value, paymentMethod: null, paymentDetails: "" };
  }
}

export function encodePaymentNote(
  note: string,
  paymentMethod: PaymentMethod | null,
  paymentDetails: string,
) {
  const cleanNote = decodePaymentNote(note).note;
  if (!paymentMethod) return cleanNote;
  const encoded = Buffer.from(JSON.stringify({
    method: paymentMethod,
    details: paymentDetails,
  }), "utf8").toString("base64url");
  return `${PAYMENT_NOTE_PREFIX}${encoded}]]${cleanNote ? `\n${cleanNote}` : ""}`;
}
