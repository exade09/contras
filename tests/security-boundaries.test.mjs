import assert from "node:assert/strict";
import test from "node:test";

import { constantTimeTextEqual, isStrongServerSecret, mutationOriginAllowed, safeReturnPathValue, serializeSessionCookie, sessionRoleAllowed, validEnvironmentAdminCredentials } from "../lib/server/security.ts";

test("session cookies are HTTP-only, same-site, scoped, and secure on HTTPS", () => {
  const header = serializeSessionCookie(new Request("https://inventory.example.test/api/auth/login"), "contras_session", "secret-token", 3600);
  assert.match(header, /^contras_session=secret-token;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.match(header, /Secure/);
});

test("mutation origin validation rejects missing and cross-origin headers", () => {
  assert.equal(mutationOriginAllowed(new Request("https://inventory.example.test/api/action")), false);
  assert.equal(mutationOriginAllowed(new Request("https://inventory.example.test/api/action", { headers: { origin: "https://attacker.example" } })), false);
  assert.equal(mutationOriginAllowed(new Request("https://inventory.example.test/api/action", { headers: { origin: "https://inventory.example.test" } })), true);
});

test("return paths cannot escape the application origin", () => {
  assert.equal(safeReturnPathValue("/workspace?view=catalog"), "/workspace?view=catalog");
  assert.equal(safeReturnPathValue("//attacker.example/path", "/workspace"), "/workspace");
  assert.equal(safeReturnPathValue("https://attacker.example", "/workspace"), "/workspace");
});

test("constant-time comparison helper handles equal and unequal digests", () => {
  assert.equal(constantTimeTextEqual("a".repeat(64), "a".repeat(64)), true);
  assert.equal(constantTimeTextEqual("a".repeat(64), "b".repeat(64)), false);
  assert.equal(constantTimeTextEqual("short", "different-length"), false);
});

test("authentication and administrator role boundaries reject blocked and non-admin accounts", () => {
  assert.equal(sessionRoleAllowed({ status: "active", role: "user" }, "user"), true);
  assert.equal(sessionRoleAllowed({ status: "blocked", role: "admin" }, "user"), false);
  assert.equal(sessionRoleAllowed({ status: "active", role: "user" }, "admin"), false);
  assert.equal(sessionRoleAllowed({ status: "active", role: "admin" }, "admin"), true);
  assert.equal(sessionRoleAllowed(null, "admin"), false);
});

test("production secrets reject examples, placeholders, weak passwords, and repeated characters", () => {
  assert.equal(isStrongServerSecret("replace-with-at-least-32-random-bytes", 32), false);
  assert.equal(isStrongServerSecret("x".repeat(64), 32), false);
  assert.equal(isStrongServerSecret("t4wP!2jxvB0mQ7zaL9Ks3uDe8cYf6nHr", 32), true);
  assert.equal(validEnvironmentAdminCredentials("admin", "replace-with-a-long-random-password"), false);
  assert.equal(validEnvironmentAdminCredentials("admin", "T7!mQ2#vZ9@kL4$p"), true);
});
