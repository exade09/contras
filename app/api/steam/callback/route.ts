import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { steamAuthStates, steamLinks, users } from "@/db/schema";
import {
  getSessionUser,
  issueSession,
  routeError,
  sha256,
} from "@/lib/server/auth";
import {
  applyVerifiedSteamProfile,
  clearSteamNonceCookie,
  loadSteamProfile,
  mutableRedirect,
  steamBrowserBinding,
  steamStatusRedirect,
  type SteamProfileSnapshot,
  type SteamAuthWorkflowOutcome,
} from "@/lib/server/steam-auth-flow";
import {
  canonicalAppOrigin,
  checkSteamOpenIdAuthentication,
  isValidOpenIdState,
  validateSteamOpenIdCallback,
} from "@/lib/server/steam-openid";
import { runtimeEnv } from "@/lib/server/storage";

export const runtime = "nodejs";

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" &&
    (error as { code?: unknown }).code === "23505",
  );
}

function linkUpdate(profile: SteamProfileSnapshot, now: string) {
  return {
    steamId: profile.steamId64,
    profileUrl: profile.profileUrl,
    updatedAt: now,
    verifiedAt: now,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  };
}

function redirectWithCookies(
  request: Request,
  origin: string,
  returnTo: string,
  status: string,
  sessionCookie?: string,
) {
  const response = mutableRedirect(
    steamStatusRedirect(origin, returnTo, status),
  );
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.append("set-cookie", clearSteamNonceCookie(request));
  if (sessionCookie) response.headers.append("set-cookie", sessionCookie);
  return response;
}

export async function GET(request: Request) {
  let origin: string | null = null;
  try {
    const configuredUrl = runtimeEnv().NEXT_PUBLIC_APP_URL;
    origin = canonicalAppOrigin(configuredUrl);
    const requestUrl = new URL(request.url);
    const state = requestUrl.searchParams.get("state");
    if (!isValidOpenIdState(state)) {
      return redirectWithCookies(request, origin, "/", "invalid_state");
    }

    const db = getDb();
    const stateHash = await sha256(state);
    const stateRows = await db.select().from(steamAuthStates).where(and(
      eq(steamAuthStates.stateHash, stateHash),
      gt(steamAuthStates.expiresAt, new Date().toISOString()),
      isNull(steamAuthStates.consumedAt),
    )).limit(1);
    const stateRow = stateRows[0];
    if (!stateRow || !(await steamBrowserBinding(request, stateRow.nonceHash))) {
      return redirectWithCookies(request, origin, stateRow?.returnTo || "/", "invalid_state");
    }

    const currentUser = await getSessionUser(request);
    if (
      stateRow.intent === "link" &&
      (!stateRow.userId || currentUser?.id !== stateRow.userId)
    ) {
      return redirectWithCookies(request, origin, stateRow.returnTo, "invalid_state");
    }

    const validated = validateSteamOpenIdCallback(requestUrl, {
      configuredUrl,
      expectedState: state,
    });
    if (!validated.ok) {
      const status = validated.error === "cancelled"
        ? "cancelled"
        : validated.error === "invalid_state"
          ? "invalid_state"
          : "verification_failed";
      return redirectWithCookies(request, origin, stateRow.returnTo, status);
    }

    const verification = await checkSteamOpenIdAuthentication(validated.assertion);
    if (!verification.valid) {
      const status = verification.reason === "timeout" ||
        verification.reason === "rate_limited" ||
        verification.reason === "upstream_unavailable"
        ? "steam_unavailable"
        : "verification_failed";
      return redirectWithCookies(request, origin, stateRow.returnTo, status);
    }

    const now = new Date().toISOString();
    const responseNonceHash = await sha256(validated.assertion.responseNonce);
    let claimedState: Array<{ stateHash: string }>;
    try {
      claimedState = await db.update(steamAuthStates).set({
        consumedAt: now,
        openIdResponseNonceHash: responseNonceHash,
      }).where(and(
        eq(steamAuthStates.stateHash, stateHash),
        gt(steamAuthStates.expiresAt, now),
        isNull(steamAuthStates.consumedAt),
      )).returning({ stateHash: steamAuthStates.stateHash });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return redirectWithCookies(request, origin, stateRow.returnTo, "verification_failed");
    }
    if (!claimedState.length) {
      return redirectWithCookies(request, origin, stateRow.returnTo, "invalid_state");
    }

    const profile = await loadSteamProfile(validated.assertion.steamId64, {
      apiKey: runtimeEnv().STEAM_API_KEY,
    });
    let outcome: SteamAuthWorkflowOutcome;

    try {
      outcome = await db.transaction(async (transaction): Promise<SteamAuthWorkflowOutcome> => {
        return applyVerifiedSteamProfile({
          intent: stateRow.intent === "link" ? "link" : "login",
          stateUserId: stateRow.userId,
          currentUserId: currentUser?.id ?? null,
          profile,
          now,
        }, {
          async findLinkedUserId(steamId64) {
            const rows = await transaction.select({ userId: steamLinks.userId })
              .from(steamLinks).where(eq(steamLinks.steamId, steamId64)).limit(1);
            return rows[0]?.userId ?? null;
          },
          async findAccount(userId) {
            const rows = await transaction.select({ id: users.id, status: users.status })
              .from(users).where(eq(users.id, userId)).limit(1);
            return rows[0] ?? null;
          },
          async loginExists(login) {
            const rows = await transaction.select({ id: users.id })
              .from(users).where(eq(users.login, login)).limit(1);
            return Boolean(rows.length);
          },
          async createAccount(record) {
            await transaction.insert(users).values({
              ...record,
              passwordHash: null,
              passwordSalt: null,
            });
          },
          async upsertVerifiedLink(userId, verifiedProfile, verifiedAt) {
            const current = await transaction.select({ userId: steamLinks.userId })
              .from(steamLinks).where(eq(steamLinks.userId, userId)).limit(1);
            if (current.length) {
              await transaction.update(steamLinks)
                .set(linkUpdate(verifiedProfile, verifiedAt))
                .where(eq(steamLinks.userId, userId));
            } else {
              await transaction.insert(steamLinks).values({
                userId,
                steamId: verifiedProfile.steamId64,
                displayName: verifiedProfile.displayName,
                avatarUrl: verifiedProfile.avatarUrl,
                profileUrl: verifiedProfile.profileUrl,
                createdAt: verifiedAt,
                updatedAt: verifiedAt,
                verifiedAt,
              });
            }
          },
          async touchLogin(userId, loginAt) {
            await transaction.update(users).set({ lastLoginAt: loginAt, updatedAt: loginAt })
              .where(eq(users.id, userId));
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      outcome = { kind: "conflict" };
    }

    if (outcome.kind === "invalid") {
      return redirectWithCookies(request, origin, stateRow.returnTo, "invalid_state");
    }
    if (outcome.kind === "conflict") {
      return redirectWithCookies(request, origin, stateRow.returnTo, "already_linked");
    }
    if (outcome.kind === "blocked") {
      return redirectWithCookies(request, origin, stateRow.returnTo, "account_blocked");
    }

    const nextSessionCookie = await issueSession(request, outcome.userId);
    return redirectWithCookies(
      request,
      origin,
      stateRow.returnTo,
      "connected",
      nextSessionCookie,
    );
  } catch (error) {
    const response = routeError(error);
    response.headers.append("set-cookie", clearSteamNonceCookie(request));
    return response;
  }
}
