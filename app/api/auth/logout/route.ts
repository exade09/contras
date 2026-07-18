import { destroySession, routeError } from "@/lib/server/auth";
import { jsonError, sameOrigin } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
    const response = Response.json({ ok: true });
    response.headers.append("set-cookie", await destroySession(request));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
