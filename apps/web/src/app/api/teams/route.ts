import { z } from "zod";
import { teamNameSchema } from "@cryptum/contracts";
import { body, endpoint, json, sameOrigin } from "../../../server/http";
import { createTeam, sessionCookie, snapshot } from "../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = endpoint(async (request) => {
  sameOrigin(request);
  const input = await body(request, z.object({ teamName: teamNameSchema }).strict());
  const { token, teamId, accessCode } = await createTeam(request, input.teamName);
  const response = json({ session: await snapshot(teamId), accessCode }, 201);
  response.headers.set("Set-Cookie", sessionCookie(token));
  return response;
});
