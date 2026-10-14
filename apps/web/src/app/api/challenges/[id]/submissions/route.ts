import { z } from "zod";
import { submitFlag } from "../../../../../server/challenges";
import { body, challengeId, endpoint, json, sameOrigin } from "../../../../../server/http";
import { requireTeam } from "../../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (request) => {
    sameOrigin(request);
    const teamId = await requireTeam(request);
    const id = challengeId((await context.params).id);
    const { flag } = await body(request, z.object({ flag: z.string().min(1).max(200) }).strict());
    return json(await submitFlag(teamId, id, flag));
  })(request);
}
