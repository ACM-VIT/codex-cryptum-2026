import { resetConversation } from "../../../../../server/challenges";
import { challengeId, endpoint, json, sameOrigin } from "../../../../../server/http";
import { requireTeam } from "../../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (request) => {
    sameOrigin(request);
    const teamId = await requireTeam(request);
    return json(await resetConversation(teamId, challengeId((await context.params).id)));
  })(request);
}
