import { z } from "zod";
import { sendMessage } from "../../../../../server/challenges";
import { body, challengeId, endpoint, json, sameOrigin } from "../../../../../server/http";
import { requireTeam } from "../../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (request) => {
    sameOrigin(request);
    const teamId = await requireTeam(request);
    const id = challengeId((await context.params).id);
    const { content } = await body(request, z.object({ content: z.string().trim().min(1).max(2000) }).strict());
    return json(await sendMessage(teamId, id, content));
  })(request);
}
