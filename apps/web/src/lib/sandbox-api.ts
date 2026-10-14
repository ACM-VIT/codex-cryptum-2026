import { z } from "zod";
import { ApiError } from "./api";

const entrySchema = z.object({
  team_id: z.string(), display_name: z.string(), score: z.number(),
});
const boardSchema = z.object({
  scope: z.literal("challenge-sandbox"),
  objective: z.string().optional(),
  entries: z.array(entrySchema.extend({ rank: z.number() })),
});
export type SandboxBoard = z.infer<typeof boardSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, method = "GET", body?: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/challenge/leaderboard${path}`, {
      method, credentials: "include", cache: "no-store",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError("Sandbox connection lost. Try again.");
  }
  if (!response.ok) {
    throw new ApiError(response.status === 401
      ? "Sandbox authorization required. Check your participant or organizer token."
      : `Sandbox request failed (${response.status}).`, response.status);
  }
  try { return schema.parse(await response.json()); }
  catch { throw new ApiError("The sandbox returned an unexpected response."); }
}

export const sandboxApi = {
  leaderboard: () => request("", boardSchema),
  update: (teamId: string, data: { score: number; display_name: string }, token?: string) =>
    request(`/teams/${encodeURIComponent(teamId)}`, z.object({ entry: entrySchema, scope: z.literal("challenge-sandbox") }), "PATCH", data, token),
  complete: (token?: string) => request("/complete", z.object({ completed: z.boolean(), points_awarded: z.number() }), "POST", {}, token),
  reset: (organizerToken: string) => request("/reset", z.object({ reset: z.literal(true), scope: z.literal("challenge-sandbox") }), "POST", {}, organizerToken),
};
