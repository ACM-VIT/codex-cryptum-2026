import { z } from "zod";
import { body, endpoint, HttpError, json, sameOrigin } from "../../../../../../server/http";
import { patchSandboxTeam } from "../../../../../../server/sandbox";
import { requireTeam } from "../../../../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (request) => {
    sameOrigin(request);
    const teamId = await requireTeam(request);
    const target = (await context.params).id;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(target)) throw new HttpError(404, "Sandbox team not found");
    const patch = await body(request, z.object({ score: z.number().int().min(0).max(1_000_000).optional(), display_name: z.string().trim().min(1).max(40).optional() }).strict());
    return json(await patchSandboxTeam(teamId, target, patch));
  })(request);
}
