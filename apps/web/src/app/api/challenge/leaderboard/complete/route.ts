import { z } from "zod";
import { body, endpoint, json, sameOrigin } from "../../../../../server/http";
import { completeSandbox } from "../../../../../server/sandbox";
import { requireTeam } from "../../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = endpoint(async (request) => {
  sameOrigin(request);
  const teamId = await requireTeam(request);
  await body(request, z.object({}).strict());
  return json(await completeSandbox(teamId));
});
