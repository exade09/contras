import { lt } from "drizzle-orm";
import { getDb } from "@/db";
import { steamAuthStates } from "@/db/schema";
import { getSessionUser, routeError, sha256 } from "@/lib/server/auth";
import {
  createSteamAuthTokens,
  mutableRedirect,
  STEAM_AUTH_TTL_SECONDS,
  steamNonceCookie,
} from "@/lib/server/steam-auth-flow";
import { buildSteamOpenIdAuthenticationUrl } from "@/lib/server/steam-openid";
import { runtimeEnv, safeReturnPath } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const intent = user ? "link" : "login";
    const returnTo = safeReturnPath(
      new URL(request.url).searchParams.get("return_to"),
      "/workspace",
    );
    const { state, browserNonce } = createSteamAuthTokens();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + STEAM_AUTH_TTL_SECONDS * 1_000,
    ).toISOString();
    const [stateHash, nonceHash] = await Promise.all([
      sha256(state),
      sha256(browserNonce),
    ]);
    const db = getDb();
    await db.transaction(async (transaction) => {
      // Retain consumed rows until expiry so the unique response-nonce hash
      // remains an effective replay barrier for the whole nonce window.
      await transaction.delete(steamAuthStates).where(
        lt(steamAuthStates.expiresAt, now.toISOString()),
      );
      await transaction.insert(steamAuthStates).values({
        stateHash,
        userId: user?.id ?? null,
        nonceHash,
        intent,
        returnTo,
        createdAt: now.toISOString(),
        expiresAt,
      });
    });

    const redirect = buildSteamOpenIdAuthenticationUrl({
      configuredUrl: runtimeEnv().NEXT_PUBLIC_APP_URL,
      state,
    });
    const response = mutableRedirect(redirect);
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.append("set-cookie", steamNonceCookie(request, browserNonce));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
