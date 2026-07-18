export function parseHttpOrigin(value: string, label = "Origin") {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid absolute URL.`); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must contain only an HTTP(S) origin.`);
  }
  return url.origin;
}

export function mutationOriginAllowed(request: Request, configuredOrigin?: string) {
  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  try {
    const expected = configuredOrigin?.trim() ? parseHttpOrigin(configuredOrigin, "Configured origin") : new URL(request.url).origin;
    return parseHttpOrigin(supplied, "Origin header") === expected;
  } catch { return false; }
}

export function safeReturnPathValue(value: unknown, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://return-path.invalid");
    if (parsed.origin !== "https://return-path.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
}

export function constantTimeTextEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function sessionRoleAllowed(
  account: { status: string; role: string } | null | undefined,
  requiredRole: "user" | "admin" = "user",
) {
  if (!account || account.status !== "active") return false;
  return requiredRole === "user" || account.role === "admin";
}

const PLACEHOLDER_SECRET = /(replace[-_ ]?with|change[-_ ]?me|example|placeholder|your[-_ ]?secret|password)/i;

export function isStrongServerSecret(value: unknown, minimumLength = 32) {
  if (typeof value !== "string" || value.length < minimumLength) return false;
  if (PLACEHOLDER_SECRET.test(value) || /^(.)\1+$/.test(value)) return false;
  return true;
}

export function validEnvironmentAdminCredentials(login: unknown, password: unknown) {
  return typeof login === "string" && /^[a-z0-9._-]{3,64}$/i.test(login.trim()) &&
    isStrongServerSecret(password, 16);
}

export function secureCookieRequest(request: Request) {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}

export function serializeSessionCookie(request: Request, name: string, token: string, maxAge: number) {
  const secure = secureCookieRequest(request) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
