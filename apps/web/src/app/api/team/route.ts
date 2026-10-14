import { z } from "zod";
import { teamNameSchema } from "@cryptum/contracts";
import { body, endpoint, json, sameOrigin } from "../../../server/http";
import { renameTeam, snapshot, teamDetails } from "../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => json(await teamDetails(request)));
export const PATCH = endpoint(async (request) => {
  sameOrigin(request);
  const input = await body(request, z.object({ teamName: teamNameSchema }).strict());
  return json(await snapshot(await renameTeam(request, input.teamName)));
});
