import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { steamLinks } from "@/db/schema";
import { getSessionUser, routeError } from "@/lib/server/auth";
import { loadSteamProfile } from "@/lib/server/steam-auth-flow";
import { runtimeEnv } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    let user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
    const apiKey = runtimeEnv().STEAM_API_KEY?.trim();
    if (user.steamId && apiKey && (!user.steam?.displayName || !user.steam.avatarUrl)) {
      const profile = await loadSteamProfile(user.steamId, { apiKey });
      if (profile.displayName || profile.avatarUrl) {
        const now = new Date().toISOString();
        const displayName = profile.displayName || user.steam?.displayName || null;
        const avatarUrl = profile.avatarUrl || user.steam?.avatarUrl || null;
        await getDb().update(steamLinks).set({
          displayName,
          avatarUrl,
          profileUrl: profile.profileUrl,
          updatedAt: now,
        }).where(eq(steamLinks.userId, user.id));
        user = {
          ...user,
          steamDisplayName: displayName,
          steamAvatarUrl: avatarUrl,
          steam: {
            steamId: user.steamId,
            displayName,
            avatarUrl,
            profileUrl: profile.profileUrl,
          },
        };
      }
    }
    return Response.json({ user }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    return routeError(error);
  }
}
