import { endpoint, json } from "../../../server/http";
import { teamDetails } from "../../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async (request) => json(await teamDetails(request)));
