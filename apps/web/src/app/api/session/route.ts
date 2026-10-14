import { z } from "zod";
import { body, endpoint, json, sameOrigin } from "../../../server/http";
import { currentTeam, joinTeam, leaveTeam, sessionCookie, snapshot } from "../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => {
  const teamId = await currentTeam(request, true);
  return json(teamId ? await snapshot(teamId) : null);
});
export const POST = endpoint(async (request) => {
  sameOrigin(request);
  const input = await body(request, z.object({ teamName: z.string().trim().min(1).max(80), accessCode: z.string().min(1).max(128) }).strict());
  const { token, teamId } = await joinTeam(request, input.teamName, input.accessCode);
  const response = json(await snapshot(teamId));
  response.headers.set("Set-Cookie", sessionCookie(token));
  return response;
});
export const DELETE = endpoint(async (request) => {
  sameOrigin(request);
  await leaveTeam(request);
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie("", true));
  return response;
});
