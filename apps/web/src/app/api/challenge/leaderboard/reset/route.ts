import { z } from "zod";
import { body, endpoint, json, sameOrigin } from "../../../../../server/http";
import { requireOrganizer, resetSandbox } from "../../../../../server/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = endpoint(async (request) => {
  // Explicit Bearer authentication is not an ambient cookie credential. Permit CLI
  // organizer requests without Origin, but reject cross-origin browser requests.
  if (request.headers.has("origin") || request.headers.get("sec-fetch-site") === "cross-site") sameOrigin(request);
  requireOrganizer(request);
  await body(request, z.object({}).strict());
  return json(await resetSandbox());
});
