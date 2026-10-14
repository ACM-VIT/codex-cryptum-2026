import { z } from "zod";
import { body, endpoint, json, sameOrigin } from "../../../server/http";
import { currentTeam, joinTeam, leaveTeam, restoreTeam, sessionCookie, snapshot } from "../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => {
  const teamId = await currentTeam(request, true);
  if (teamId) return json(await snapshot(teamId));
  const restored = await restoreTeam(request);
  if (!restored) return json(null);
  const response = json(await snapshot(restored.teamId));
  response.headers.set("Set-Cookie", sessionCookie(restored.token));
  return response;
});
export const POST = endpoint(async (request) => {
  sameOrigin(request);
  const input = await body(request, z.object({ accessCode: z.string().trim().min(1).max(128), teamName: z.string().trim().min(1).max(80).optional() }).strict());
  const { token, teamId } = await joinTeam(request, input.accessCode, input.teamName);
  const response = json(await snapshot(teamId));
  response.headers.set("Set-Cookie", sessionCookie(token));
  return response;
});
export const DELETE = endpoint(async (request) => {
  sameOrigin(request);
  const input = await body(request, z.object({ confirmDelete: z.boolean().optional() }).strict());
  const { deleted } = await leaveTeam(request, input.confirmDelete);
  const response = json({ ok: true, deleted });
  response.headers.set("Set-Cookie", sessionCookie("", true));
  return response;
});
