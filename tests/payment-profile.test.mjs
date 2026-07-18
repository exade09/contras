import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptCardNumber,
  encryptCardNumber,
  formatUserPaymentProfile,
  normalizeCardNumber,
  normalizeKaspiPhone,
  serializeUserPaymentProfile,
  validateUserPaymentProfile,
} from "../lib/server/payment-profile.ts";

test("Kaspi payout profiles normalize phone and a valid full card number", () => {
  assert.equal(normalizeKaspiPhone("+7 (700) 123-45-67"), "+77001234567");
  assert.equal(normalizeCardNumber("4111 1111 1111 1111"), "4111111111111111");
  assert.deepEqual(validateUserPaymentProfile({
    recipientName: "  Test   Recipient ",
    kaspiPhone: "+7 (700) 123-45-67",
    cardNumber: "4111 1111 1111 1111",
  }), {
    ok: true,
    value: {
      method: "kaspi_card",
      recipientName: "Test Recipient",
      kaspiPhone: "+77001234567",
      cardLast4: "1111",
      cardNumber: "4111111111111111",
    },
  });
});

test("Kaspi payout profiles require a recipient and safe reference", () => {
  assert.equal(validateUserPaymentProfile({ recipientName: "", kaspiPhone: "+77001234567" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", cardNumber: "4111" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient" }, "1111").ok, true);
});

test("Kaspi payout profiles reject card numbers in non-card fields and invalid PANs", () => {
  assert.equal(validateUserPaymentProfile({ recipientName: "4111 1111 1111 1111", cardNumber: "4111111111111111" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", kaspiPhone: "4111 1111 1111 1111" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", kaspiPhone: "4111111111111" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", cardNumber: "4111111111111112" }).ok, false);
});

test("card PAN encryption is authenticated, user-bound, and reversible only with the key", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const envelope = encryptCardNumber("4111111111111111", "user-one", key);
  assert.match(envelope, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(envelope, /4111111111111111/);
  assert.equal(decryptCardNumber(envelope, "user-one", key), "4111111111111111");
  assert.throws(() => decryptCardNumber(envelope, "user-two", key));
  assert.throws(() => decryptCardNumber(`${envelope}x`, "user-one", key));
});

test("ordinary payment profile serialization never exposes encrypted or full card data", () => {
  const serialized = serializeUserPaymentProfile({
    userId: "user-one",
    method: "kaspi_card",
    recipientName: "Test Recipient",
    kaspiPhone: "+77001234567",
    cardLast4: "1111",
    cardPanEncrypted: "v1.example.encrypted",
    updatedByRole: "user",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });

  assert.equal(serialized.hasCardNumber, true);
  assert.equal(serialized.cardMask, "•••• 1111");
  assert.equal("cardPanEncrypted" in serialized, false);
  assert.equal("cardNumber" in serialized, false);
});

test("payout profile formatting contains only safe payment references", () => {
  assert.equal(formatUserPaymentProfile({
    recipientName: "Test Recipient",
    kaspiPhone: "+77001234567",
    cardLast4: "1111",
  }), "Test Recipient · Kaspi phone +77001234567 · card ending 1111");
});
