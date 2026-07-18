import { getSessionUser, routeError } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
    return Response.json({ user }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    return routeError(error);
  }
}
