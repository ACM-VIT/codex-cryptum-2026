import { officialLeaderboard } from "../../../server/challenges";
import { endpoint, json } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = endpoint(async () => json(await officialLeaderboard()));
