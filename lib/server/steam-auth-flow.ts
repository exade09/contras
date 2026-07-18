export const STEAM_NONCE_COOKIE = "contras_steam_nonce";
export const STEAM_AUTH_TTL_SECONDS = 10 * 60;

export type SteamAuthIntent = "login" | "link";

export type SteamProfileSnapshot = {
  steamId64: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
};

export type SteamAuthAction =
  | "register"
  | "login_existing"
  | "link_new"
  | "link_existing"
  | "conflict"
  | "invalid_link_session";

export type SteamAuthWorkflowOutcome =
  | { kind: "authenticated"; userId: string }
  | { kind: "conflict" }
  | { kind: "blocked" }
  | { kind: "invalid" };

export type SteamRegistrationRecord = {
  id: string;
  login: string;
  displayName: string;
  role: "user";
  status: "active";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export interface SteamAuthWorkflowStore {
  findLinkedUserId(steamId64: string): Promise<string | null>;
  findAccount(userId: string): Promise<{ id: string; status: string } | null>;
  loginExists(login: string): Promise<boolean>;
  createAccount(record: SteamRegistrationRecord): Promise<void>;
  upsertVerifiedLink(userId: string, profile: SteamProfileSnapshot, now: string): Promise<void>;
  touchLogin(userId: string, now: string): Promise<void>;
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let raw = "";
  for (const byte of data) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function hashBinding(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSteamAuthTokens() {
  return { state: randomToken(), browserNonce: randomToken() };
}

export function steamNonceCookie(request: Request, value: string, maxAge = STEAM_AUTH_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:"
    ? "; Secure"
    : "";
  return `${STEAM_NONCE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/api/steam; Max-Age=${maxAge}${secure}`;
}

export function clearSteamNonceCookie(request: Request) {
  return steamNonceCookie(request, "", 0);
}

export async function steamBrowserBinding(request: Request, expectedNonceHash: string) {
  const nonce = cookieValue(request, STEAM_NONCE_COOKIE);
  if (!nonce || nonce.length < 32 || nonce.length > 256) return false;
  const actualHash = await hashBinding(nonce);
  if (actualHash.length !== expectedNonceHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedNonceHash.charCodeAt(index);
  }
  return difference === 0;
}

export function resolveSteamAuthAction(input: {
  intent: SteamAuthIntent;
  stateUserId: string | null;
  currentUserId: string | null;
  linkedUserId: string | null;
}): SteamAuthAction {
  if (input.intent === "login") {
    return input.linkedUserId ? "login_existing" : "register";
  }
  if (!input.stateUserId || input.currentUserId !== input.stateUserId) {
    return "invalid_link_session";
  }
  if (!input.linkedUserId) return "link_new";
  return input.linkedUserId === input.stateUserId ? "link_existing" : "conflict";
}

export async function applyVerifiedSteamProfile(
  input: {
    intent: SteamAuthIntent;
    stateUserId: string | null;
    currentUserId: string | null;
    profile: SteamProfileSnapshot;
    now: string;
    idFactory?: () => string;
  },
  store: SteamAuthWorkflowStore,
): Promise<SteamAuthWorkflowOutcome> {
  const linkedUserId = await store.findLinkedUserId(input.profile.steamId64);
  const action = resolveSteamAuthAction({
    intent: input.intent,
    stateUserId: input.stateUserId,
    currentUserId: input.currentUserId,
    linkedUserId,
  });
  if (action === "invalid_link_session") return { kind: "invalid" };
  if (action === "conflict") return { kind: "conflict" };

  if (action === "register") {
    const idFactory = input.idFactory ?? crypto.randomUUID;
    const userId = idFactory();
    const baseLogin = `steam_${input.profile.steamId64}`;
    const login = await store.loginExists(baseLogin)
      ? `${baseLogin}_${idFactory().replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`
      : baseLogin;
    await store.createAccount({
      id: userId,
      login,
      displayName: input.profile.displayName || `Steam user ${input.profile.steamId64.slice(-6)}`,
      role: "user",
      status: "active",
      createdAt: input.now,
      updatedAt: input.now,
      lastLoginAt: input.now,
    });
    await store.upsertVerifiedLink(userId, input.profile, input.now);
    return { kind: "authenticated", userId };
  }

  if (action === "login_existing") {
    const account = await store.findAccount(linkedUserId!);
    if (!account || account.status !== "active") return { kind: "blocked" };
    await store.upsertVerifiedLink(account.id, input.profile, input.now);
    await store.touchLogin(account.id, input.now);
    return { kind: "authenticated", userId: account.id };
  }

  const userId = input.stateUserId!;
  const account = await store.findAccount(userId);
  if (!account || account.status !== "active") return { kind: "blocked" };
  await store.upsertVerifiedLink(userId, input.profile, input.now);
  return { kind: "authenticated", userId };
}

function trustedSteamAvatar(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && [
      "avatars.akamai.steamstatic.com",
      "avatars.cloudflare.steamstatic.com",
      "avatars.fastly.steamstatic.com",
      "avatars.steamstatic.com",
      "steamcdn-a.akamaihd.net",
    ].includes(url.hostname.toLocaleLowerCase("en-US"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeDisplayName(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return cleaned || null;
}

type ProfileFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Optional profile enrichment. OpenID verification never depends on this API. */
export async function loadSteamProfile(
  steamId64: string,
  options: {
    apiKey?: string;
    fetchImpl?: ProfileFetchLike;
    timeoutMs?: number;
  } = {},
): Promise<SteamProfileSnapshot> {
  const fallback: SteamProfileSnapshot = {
    steamId64,
    displayName: null,
    avatarUrl: null,
    profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
  };
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return fallback;

  const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("steamids", steamId64);
  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? 7_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        headers: {
          accept: "application/json",
          "user-agent": "contras.fun Steam profile enrichment",
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > 64 * 1024) return null;
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return null;
      }
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    const payload = await Promise.race([request, timeout]);
    if (!payload || typeof payload !== "object") return fallback;
    const response = (payload as { response?: unknown }).response;
    if (!response || typeof response !== "object") return fallback;
    const players = (response as { players?: unknown }).players;
    if (!Array.isArray(players)) return fallback;
    const player = players.find((entry) =>
      entry && typeof entry === "object" &&
      (entry as { steamid?: unknown }).steamid === steamId64,
    ) as { personaname?: unknown; avatarfull?: unknown } | undefined;
    if (!player) return fallback;
    return {
      ...fallback,
      displayName: safeDisplayName(player.personaname),
      avatarUrl: trustedSteamAvatar(player.avatarfull),
    };
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function steamStatusRedirect(
  canonicalOrigin: string,
  returnPath: string,
  status: string,
) {
  const target = new URL(returnPath, canonicalOrigin);
  if (target.origin !== canonicalOrigin) throw new Error("Invalid Steam return path.");
  target.searchParams.set("steam", status);
  return target;
}
