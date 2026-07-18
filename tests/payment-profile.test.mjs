import assert from "node:assert/strict";
import test from "node:test";

import {
  formatUserPaymentProfile,
  normalizeKaspiPhone,
  validateUserPaymentProfile,
} from "../lib/server/payment-profile.ts";

test("Kaspi payout profiles normalize safe phone and last-four references", () => {
  assert.equal(normalizeKaspiPhone("+7 (700) 123-45-67"), "+77001234567");
  assert.deepEqual(validateUserPaymentProfile({
    recipientName: "  Test   Recipient ",
    kaspiPhone: "+7 (700) 123-45-67",
    cardLast4: "1111",
  }), {
    ok: true,
    value: {
      method: "kaspi_card",
      recipientName: "Test Recipient",
      kaspiPhone: "+77001234567",
      cardLast4: "1111",
    },
  });
});

test("Kaspi payout profiles require a recipient and safe reference", () => {
  assert.equal(validateUserPaymentProfile({ recipientName: "", kaspiPhone: "+77001234567" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", cardLast4: "11" }).ok, false);
});

test("Kaspi payout profiles reject full card numbers everywhere", () => {
  const fullNumber = "4111 1111 1111 1111";
  assert.equal(validateUserPaymentProfile({ recipientName: fullNumber, cardLast4: "9713" }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", kaspiPhone: fullNumber }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", cardLast4: fullNumber }).ok, false);
  assert.equal(validateUserPaymentProfile({ recipientName: "Test Recipient", kaspiPhone: "4111111111111" }).ok, false);
});

test("payout profile formatting contains only safe payment references", () => {
  assert.equal(formatUserPaymentProfile({
    recipientName: "Test Recipient",
    kaspiPhone: "+77001234567",
    cardLast4: "1111",
  }), "Test Recipient · Kaspi phone +77001234567 · card ending 1111");
});
