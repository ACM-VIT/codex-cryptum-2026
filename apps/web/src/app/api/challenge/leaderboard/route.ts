import { endpoint, json } from "../../../../server/http";
import { sandboxLeaderboard } from "../../../../server/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async () => json(await sandboxLeaderboard()));
