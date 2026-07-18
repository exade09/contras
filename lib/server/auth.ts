import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, steamLinks, users } from "@/db/schema";
import { runtimeEnv } from "./storage";
import { constantTimeTextEqual, isStrongServerSecret, secureCookieRequest, serializeSessionCookie, sessionRoleAllowed } from "./security";

export type SteamSessionProfile = {
  steamId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
};

export type SessionUser = {
  id: string;
  login: string;
  displayName: string;
  role: "admin" | "user";
  status: string;
  steamId: string | null;
  steamDisplayName: string | null;
  steamAvatarUrl: string | null;
  steam: SteamSessionProfile | null;
};

const encoder = new TextEncoder();
export const SESSION_COOKIE = "contras_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_HASH_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function base64ToBytes(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function randomToken(bytes = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function constantTimeEqual(left: string, right: string) {
  return constantTimeTextEqual(left, right);
}

async function hmacSha256(value: string) {
  const secret = runtimeEnv().SESSION_SECRET?.trim() || "";
  if (!isStrongServerSecret(secret, 32)) {
    throw new Error("SESSION_SECRET must be a non-placeholder secret containing at least 32 characters.");
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function hashPassword(password: string, saltBase64?: string) {
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_HASH_ITERATIONS }, key, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToBase64(salt) };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < hash.length; index += 1) difference |= hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

export function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function secureCookie(request: Request) {
  return secureCookieRequest(request);
}

export function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  return serializeSessionCookie(request, SESSION_COOKIE, token, maxAge);
}

export async function issueSession(request: Request, userId: string) {
  const db = getDb();
  const existingToken = cookieValue(request, SESSION_COOKIE);
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  const existingHash = existingToken ? await hmacSha256(existingToken) : null;
  const tokenHash = await hmacSha256(token);
  await db.transaction(async (transaction) => {
    if (existingHash) await transaction.delete(sessions).where(eq(sessions.tokenHash, existingHash));
    await transaction.insert(sessions).values({ tokenHash, userId, expiresAt, createdAt: now.toISOString() });
  });
  return sessionCookie(request, token);
}

export async function destroySession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await hmacSha256(token)));
  return sessionCookie(request, "", 0);
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const rows = await getDb().select({
    id: users.id,
    login: users.login,
    displayName: users.displayName,
    role: users.role,
    status: users.status,
    steamId: steamLinks.steamId,
    steamDisplayName: steamLinks.displayName,
    steamAvatarUrl: steamLinks.avatarUrl,
    steamProfileUrl: steamLinks.profileUrl,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(steamLinks, eq(steamLinks.userId, users.id))
    .where(and(eq(sessions.tokenHash, await hmacSha256(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .limit(1);
  const row = rows[0];
  if (!sessionRoleAllowed(row, "user")) return null;
  // Only a current OpenID-verified link authorizes inventory and ownership
  // operations. The legacy users.steam_id field is migration data, not proof.
  const steamId = row.steamId || null;
  const profileUrl = steamId ? row.steamProfileUrl || `https://steamcommunity.com/profiles/${steamId}` : null;
  return {
    id: row.id,
    login: row.login,
    displayName: row.displayName,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status,
    steamId,
    steamDisplayName: row.steamDisplayName,
    steamAvatarUrl: row.steamAvatarUrl,
    steam: steamId && profileUrl ? { steamId, displayName: row.steamDisplayName, avatarUrl: row.steamAvatarUrl, profileUrl } : null,
  };
}

export async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw Response.json({ error: "Authentication required" }, { status: 401 });
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (!sessionRoleAllowed(user, "admin")) throw Response.json({ error: "Administrator access required" }, { status: 403 });
  return user;
}

export function routeError(error: unknown) {
  if (error instanceof Response) return error;
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
