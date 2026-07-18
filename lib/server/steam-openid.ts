/**
 * Pure Steam OpenID 2.0 helpers. This module never handles Steam credentials;
 * authentication always happens at Steam's official OpenID endpoint.
 */

export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
export const STEAM_OPENID_NAMESPACE = "http://specs.openid.net/auth/2.0";
export const STEAM_OPENID_IDENTIFIER_SELECT =
  "http://specs.openid.net/auth/2.0/identifier_select";
export const DEFAULT_STEAM_CALLBACK_PATH = "/api/steam/callback";

const DEFAULT_NONCE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_NONCE_FUTURE_SKEW_MS = 2 * 60 * 1000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 8_000;
const MAX_OPENID_RESPONSE_BYTES = 4_096;
const MAX_CALLBACK_URL_LENGTH = 32_768;
const REQUIRED_SIGNED_FIELDS = [
  "op_endpoint",
  "claimed_id",
  "identity",
  "return_to",
  "response_nonce",
] as const;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SteamOpenIdValidationError =
  | "invalid_callback_origin"
  | "invalid_callback_path"
  | "invalid_state"
  | "cancelled"
  | "invalid_namespace"
  | "invalid_mode"
  | "invalid_endpoint"
  | "invalid_return_to"
  | "invalid_realm"
  | "invalid_claimed_id"
  | "identity_mismatch"
  | "invalid_nonce"
  | "incomplete_signature"
  | "invalid_parameters";

export type SteamOpenIdAssertion = {
  steamId64: string;
  claimedId: string;
  returnTo: string;
  responseNonce: string;
  state: string;
  params: URLSearchParams;
};

export type SteamOpenIdValidationResult =
  | { ok: true; assertion: SteamOpenIdAssertion }
  | { ok: false; error: SteamOpenIdValidationError };

export type SteamOpenIdCheckResult =
  | { valid: true }
  | {
      valid: false;
      reason:
        | "rejected"
        | "timeout"
        | "rate_limited"
        | "upstream_unavailable"
        | "invalid_response";
    };

export type NonceValidationResult =
  | { valid: true; issuedAt: Date }
  | { valid: false; reason: "malformed" | "expired" | "from_future" };

export class SteamOpenIdConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SteamOpenIdConfigurationError";
  }
}

function isLoopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/**
 * Returns a normalized, origin-only application URL. HTTPS is mandatory except
 * for loopback development URLs.
 */
export function canonicalAppOrigin(
  configuredUrl =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL
      : undefined,
) {
  if (!configuredUrl) {
    throw new SteamOpenIdConfigurationError(
      "NEXT_PUBLIC_APP_URL is required for Steam authentication.",
    );
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new SteamOpenIdConfigurationError(
      "NEXT_PUBLIC_APP_URL must be an absolute URL.",
    );
  }

  if (url.username || url.password) {
    throw new SteamOpenIdConfigurationError(
      "NEXT_PUBLIC_APP_URL must not contain credentials.",
    );
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new SteamOpenIdConfigurationError(
      "NEXT_PUBLIC_APP_URL must use HTTPS outside loopback development.",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new SteamOpenIdConfigurationError(
      "NEXT_PUBLIC_APP_URL must contain only the canonical origin.",
    );
  }

  return url.origin;
}

export function steamOpenIdRealm(configuredUrl?: string) {
  return `${canonicalAppOrigin(configuredUrl)}/`;
}

export function isValidSteamId64(value: unknown): value is string {
  return typeof value === "string" && /^\d{17}$/.test(value) && /[1-9]/.test(value);
}

export function isValidOpenIdState(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validateCallbackPath(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new SteamOpenIdConfigurationError(
      "The Steam callback path must be an absolute application path.",
    );
  }
  return path;
}

export function buildSteamOpenIdReturnTo(options: {
  configuredUrl?: string;
  state: string;
  callbackPath?: string;
}) {
  if (!isValidOpenIdState(options.state)) {
    throw new SteamOpenIdConfigurationError("Steam OpenID state is invalid.");
  }
  const origin = canonicalAppOrigin(options.configuredUrl);
  const callbackPath = validateCallbackPath(
    options.callbackPath ?? DEFAULT_STEAM_CALLBACK_PATH,
  );
  const callback = new URL(callbackPath, origin);
  callback.searchParams.set("state", options.state);
  return callback.toString();
}

export function buildSteamOpenIdAuthenticationUrl(options: {
  configuredUrl?: string;
  state: string;
  callbackPath?: string;
}) {
  const returnTo = buildSteamOpenIdReturnTo(options);
  const endpoint = new URL(STEAM_OPENID_ENDPOINT);
  endpoint.search = new URLSearchParams({
    "openid.ns": STEAM_OPENID_NAMESPACE,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": steamOpenIdRealm(options.configuredUrl),
    "openid.identity": STEAM_OPENID_IDENTIFIER_SELECT,
    "openid.claimed_id": STEAM_OPENID_IDENTIFIER_SELECT,
  }).toString();
  return endpoint;
}

export function validateOpenIdResponseNonce(
  nonce: unknown,
  options: {
    now?: Date;
    maxAgeMs?: number;
    futureSkewMs?: number;
  } = {},
): NonceValidationResult {
  if (
    typeof nonce !== "string" ||
    nonce.length < 21 ||
    nonce.length > 255 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\S+$/.test(nonce)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const issuedAt = new Date(nonce.slice(0, 20));
  if (!Number.isFinite(issuedAt.getTime())) {
    return { valid: false, reason: "malformed" };
  }
  const now = options.now ?? new Date();
  const age = now.getTime() - issuedAt.getTime();
  if (age < -(options.futureSkewMs ?? DEFAULT_NONCE_FUTURE_SKEW_MS)) {
    return { valid: false, reason: "from_future" };
  }
  if (age > (options.maxAgeMs ?? DEFAULT_NONCE_MAX_AGE_MS)) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, issuedAt };
}

function exactlyOne(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  if (values.length !== 1 || !values[0] || values[0].length > 2_048) return null;
  return values[0];
}

function copyOpenIdParams(params: URLSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith("openid.")) result.append(key, value);
  }
  return result;
}

/**
 * Performs local semantic validation before direct verification with Steam.
 * The caller must additionally consume `state` and `responseNonce` atomically
 * in its persistence layer to prevent replay.
 */
export function validateSteamOpenIdCallback(
  requestUrl: string | URL,
  options: {
    configuredUrl?: string;
    expectedState?: string;
    callbackPath?: string;
    now?: Date;
    nonceMaxAgeMs?: number;
    nonceFutureSkewMs?: number;
  } = {},
): SteamOpenIdValidationResult {
  const rawUrl = requestUrl.toString();
  if (rawUrl.length > MAX_CALLBACK_URL_LENGTH) {
    return { ok: false, error: "invalid_parameters" };
  }

  let url: URL;
  let origin: string;
  try {
    url = new URL(rawUrl);
    origin = canonicalAppOrigin(options.configuredUrl);
  } catch {
    return { ok: false, error: "invalid_callback_origin" };
  }

  if (url.origin !== origin) {
    return { ok: false, error: "invalid_callback_origin" };
  }
  const callbackPath = options.callbackPath ?? DEFAULT_STEAM_CALLBACK_PATH;
  try {
    if (url.pathname !== validateCallbackPath(callbackPath)) {
      return { ok: false, error: "invalid_callback_path" };
    }
  } catch {
    return { ok: false, error: "invalid_callback_path" };
  }

  const state = exactlyOne(url.searchParams, "state");
  if (
    !isValidOpenIdState(state) ||
    (options.expectedState !== undefined && state !== options.expectedState)
  ) {
    return { ok: false, error: "invalid_state" };
  }

  const mode = exactlyOne(url.searchParams, "openid.mode");
  if (mode === "cancel") return { ok: false, error: "cancelled" };
  if (mode !== "id_res") return { ok: false, error: "invalid_mode" };
  if (exactlyOne(url.searchParams, "openid.ns") !== STEAM_OPENID_NAMESPACE) {
    return { ok: false, error: "invalid_namespace" };
  }
  if (exactlyOne(url.searchParams, "openid.op_endpoint") !== STEAM_OPENID_ENDPOINT) {
    return { ok: false, error: "invalid_endpoint" };
  }

  const expectedReturnTo = buildSteamOpenIdReturnTo({
    configuredUrl: options.configuredUrl,
    state,
    callbackPath,
  });
  const returnTo = exactlyOne(url.searchParams, "openid.return_to");
  if (!returnTo || returnTo !== expectedReturnTo) {
    return { ok: false, error: "invalid_return_to" };
  }
  const realm = exactlyOne(url.searchParams, "openid.realm");
  if (realm !== null && realm !== steamOpenIdRealm(options.configuredUrl)) {
    return { ok: false, error: "invalid_realm" };
  }

  const claimedId = exactlyOne(url.searchParams, "openid.claimed_id");
  const identity = exactlyOne(url.searchParams, "openid.identity");
  if (!claimedId) return { ok: false, error: "invalid_claimed_id" };
  const claimedMatch = claimedId.match(
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/,
  );
  if (!claimedMatch || !isValidSteamId64(claimedMatch[1])) {
    return { ok: false, error: "invalid_claimed_id" };
  }
  if (identity !== claimedId) {
    return { ok: false, error: "identity_mismatch" };
  }

  const responseNonce = exactlyOne(url.searchParams, "openid.response_nonce");
  if (!responseNonce) return { ok: false, error: "invalid_nonce" };
  const nonce = validateOpenIdResponseNonce(responseNonce, {
    now: options.now,
    maxAgeMs: options.nonceMaxAgeMs,
    futureSkewMs: options.nonceFutureSkewMs,
  });
  if (!nonce.valid) return { ok: false, error: "invalid_nonce" };

  const signedValue = exactlyOne(url.searchParams, "openid.signed");
  const signature = exactlyOne(url.searchParams, "openid.sig");
  const association = exactlyOne(url.searchParams, "openid.assoc_handle");
  const signed = new Set((signedValue ?? "").split(","));
  if (
    !signature ||
    !association ||
    REQUIRED_SIGNED_FIELDS.some((field) => !signed.has(field))
  ) {
    return { ok: false, error: "incomplete_signature" };
  }

  return {
    ok: true,
    assertion: {
      steamId64: claimedMatch[1],
      claimedId,
      returnTo,
      responseNonce,
      state,
      params: copyOpenIdParams(url.searchParams),
    },
  };
}

function parseVerificationBody(body: string) {
  const values = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

/** Sends the signed callback fields back to Steam using check_authentication. */
export async function checkSteamOpenIdAuthentication(
  assertion: Pick<SteamOpenIdAssertion, "params">,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
): Promise<SteamOpenIdCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS);
  const maxResponseBytes = Math.max(
    128,
    options.maxResponseBytes ?? MAX_OPENID_RESPONSE_BYTES,
  );
  const body = copyOpenIdParams(assertion.params);
  body.set("openid.mode", "check_authentication");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = (async () => {
      const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "text/plain",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "contras.fun Steam OpenID verifier",
        },
        body,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) return { kind: "rate_limited" } as const;
      if (!response.ok) return { kind: "unavailable" } as const;
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        return { kind: "invalid" } as const;
      }
      const responseBody = await response.text();
      if (responseBody.length > maxResponseBytes) return { kind: "invalid" } as const;
      return { kind: "body", responseBody } as const;
    })();
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });
    const result = await Promise.race([request, timeout]);
    if (result.kind === "timeout") return { valid: false, reason: "timeout" };
    if (result.kind === "rate_limited") {
      return { valid: false, reason: "rate_limited" };
    }
    if (result.kind === "unavailable") {
      return { valid: false, reason: "upstream_unavailable" };
    }
    if (result.kind === "invalid") {
      return { valid: false, reason: "invalid_response" };
    }
    const values = parseVerificationBody(result.responseBody);
    if (!values) return { valid: false, reason: "invalid_response" };
    if (
      values.has("ns") &&
      values.get("ns") !== STEAM_OPENID_NAMESPACE
    ) {
      return { valid: false, reason: "invalid_response" };
    }
    return values.get("is_valid") === "true"
      ? { valid: true }
      : { valid: false, reason: "rejected" };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { valid: false, reason: "timeout" };
    }
    return { valid: false, reason: "upstream_unavailable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
