import { endpoint, json, sameOrigin } from "../../../../server/http";
import { endSession, sessionCookie } from "../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = endpoint(async (request) => {
  sameOrigin(request);
  await endSession(request);
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie("", true));
  return response;
});
