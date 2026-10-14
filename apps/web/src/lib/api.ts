import { z } from "zod";
import {
  challengeSchema,
  leaderboardSchema,
  sessionSchema,
  submissionSchema,
  type CtfApi,
} from "./contracts";

const base = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  data?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ApiError("Connection lost. Check your connection and try again.");
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Your session has expired. Rejoin your team to continue.",
      403: "Access denied. Check your team access code.",
      409: "This conversation has changed. Refresh before continuing.",
      429: "Too many requests. Wait a moment before trying again.",
      503: "The model is unavailable. Please try again shortly.",
    };
    throw new ApiError(
      messages[response.status] ?? "The request failed. Please try again.",
      response.status,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiError(
      "The server returned an unexpected response. Please contact an organizer.",
    );
  }
}

const live: CtfApi = {
  session: () => request("/session", sessionSchema.nullable()),
  join: (teamName, accessCode) =>
    request("/session", sessionSchema, "POST", { teamName, accessCode }),
  leave: async () => {
    await request("/session", z.object({ ok: z.literal(true) }), "DELETE");
  },
  challenges: () => request("/challenges", z.array(challengeSchema)),
  chat: (id, content) =>
    request(`/challenges/${id}/messages`, sessionSchema, "POST", { content }),
  reset: (id) =>
    request(`/challenges/${id}/conversation`, sessionSchema, "DELETE"),
  submit: (id, flag) =>
    request(`/challenges/${id}/submissions`, submissionSchema, "POST", {
      flag,
    }),
  leaderboard: () => request("/leaderboard", leaderboardSchema),
};

export const api: CtfApi = live;
