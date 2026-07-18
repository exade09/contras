import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePaymentNote,
  encodePaymentNote,
  paymentMethodLabel,
  validatePaymentDetails,
} from "../lib/server/payment-details.ts";

test("Kaspi payout metadata round-trips without exposing its storage envelope", () => {
  const stored = encodePaymentNote(
    "Manual review note",
    "kaspi_card",
    "Recipient · +7 700 000 00 00 · card ending 4242",
  );
  assert.match(stored, /^\[\[CONTRAS_PAYMENT_V1:/);
  assert.deepEqual(decodePaymentNote(stored), {
    note: "Manual review note",
    paymentMethod: "kaspi_card",
    paymentDetails: "Recipient · +7 700 000 00 00 · card ending 4242",
  });
  assert.equal(paymentMethodLabel("kaspi_card"), "Kaspi Bank card");
});

test("legacy notes remain readable and clearing a payment method removes metadata", () => {
  assert.deepEqual(decodePaymentNote("Legacy note"), {
    note: "Legacy note",
    paymentMethod: null,
    paymentDetails: "",
  });
  const stored = encodePaymentNote("Legacy note", "kaspi_card", "Recipient");
  assert.equal(encodePaymentNote(stored, null, ""), "Legacy note");
});

test("payout details reject card authentication secrets and full card numbers", () => {
  assert.equal(validatePaymentDetails("Recipient · +7 700 000 00 00").ok, true);
  assert.equal(validatePaymentDetails("Card ending 4242").ok, true);
  assert.equal(validatePaymentDetails("4400 4301 2345 6789").ok, false);
  assert.equal(validatePaymentDetails("CVV 123").ok, false);
  assert.equal(validatePaymentDetails("PIN 0000").ok, false);
});
