import { withDatabaseRequest } from "../../../../server/database-request";
import { toNextJsHandler } from "better-auth/next-js";
import {
  getAuth,
  getGoogleAuthConfiguration,
} from "../../../../server/better-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const configuration = getGoogleAuthConfiguration();
  if (request.method === "GET" && new URL(request.url).pathname === "/api/auth/configuration") {
    // Only variable names are exposed, never credentials or database URLs.
    return Response.json(configuration, { headers: { "Cache-Control": "no-store" } });
  }
  if (!configuration.configured) {
    return Response.json(
      { error: "Google sign-in is not configured. Ask the administrator to complete authentication setup." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const handlers = toNextJsHandler(getAuth());
  return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
}

export const GET = (request: Request) => withDatabaseRequest(() => handle(request));
export const POST = GET;
