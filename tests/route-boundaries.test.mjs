import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.ts";
import { GET as getAdminUsers, POST as createAdminUser } from "../app/api/admin/users/route.ts";
import { GET as getInventory } from "../app/api/inventory/route.ts";
import { GET as getTradeRequests, POST as createTradeRequest } from "../app/api/trade-requests/route.ts";
import { POST as disconnectSteam } from "../app/api/steam/disconnect/route.ts";
import { GET as getPaymentProfile, PUT as putPaymentProfile } from "../app/api/payment-profile/route.ts";
import { PUT as putAdminPaymentProfile } from "../app/api/admin/payment-profile/route.ts";

async function errorBody(response) {
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.doesNotMatch(body.error, /[\u0400-\u04ff]/);
  return body;
}

test("database-backed user and administrator reads reject anonymous requests before database access", async () => {
  const admin = await getAdminUsers(new Request("https://contras.example/api/admin/users"));
  assert.equal(admin.status, 401);
  assert.equal((await errorBody(admin)).error, "Authentication required");

  const inventory = await getInventory(new Request("https://contras.example/api/inventory"));
  assert.equal(inventory.status, 401);
  assert.equal((await errorBody(inventory)).error, "Authentication required");

  const requests = await getTradeRequests(new Request("https://contras.example/api/trade-requests"));
  assert.equal(requests.status, 401);
  assert.equal((await errorBody(requests)).error, "Authentication required");

  const paymentProfile = await getPaymentProfile(new Request("https://contras.example/api/payment-profile"));
  assert.equal(paymentProfile.status, 401);
  assert.equal((await errorBody(paymentProfile)).error, "Authentication required");
});

test("mutating account and sale routes reject missing Origin before authentication or writes", async () => {
  const cases = [
    createAdminUser(new Request("https://contras.example/api/admin/users", { method: "POST" })),
    createTradeRequest(new Request("https://contras.example/api/trade-requests", { method: "POST" })),
    disconnectSteam(new Request("https://contras.example/api/steam/disconnect", { method: "POST" })),
    putPaymentProfile(new Request("https://contras.example/api/payment-profile", { method: "PUT" })),
    putAdminPaymentProfile(new Request("https://contras.example/api/admin/payment-profile", { method: "PUT" })),
  ];
  for (const responsePromise of cases) {
    const response = await responsePromise;
    assert.equal(response.status, 403);
    assert.equal((await errorBody(response)).error, "Invalid request origin");
  }
});

test("application security headers deny framing and MIME sniffing", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers();
  const headers = new Map(rules[0].headers.map((header) => [header.key, header.value]));
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
});
