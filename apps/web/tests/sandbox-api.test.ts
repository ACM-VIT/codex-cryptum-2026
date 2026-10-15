import { afterEach, describe, expect, it, vi } from "vitest";
import { sandboxApi } from "../src/lib/sandbox-api";

afterEach(() => vi.unstubAllGlobals());

describe("isolated sandbox API", () => {
  it("loads only the sandbox board", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "challenge-sandbox", entries: [] })));
    vi.stubGlobal("fetch", fetcher);
    await sandboxApi.leaderboard();
    expect(fetcher).toHaveBeenCalledWith("/api/challenge/leaderboard", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  });
  it("PATCHes the target through the authenticated team session", async () => {
    const entry = { team_id: "team-cipher", display_name: "Cipher", score: 9000 };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "challenge-sandbox", entry })));
    vi.stubGlobal("fetch", fetcher);
    await sandboxApi.update(entry.team_id, { score: entry.score, display_name: entry.display_name });
    expect(fetcher).toHaveBeenCalledWith("/api/challenge/leaderboard/teams/team-cipher", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ score: 9000, display_name: "Cipher" }),
      headers: { "Content-Type": "application/json" },
    }));
  });
  it("verifies with an empty POST body and uses a distinct organizer bearer for reset", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ completed: true, points_awarded: 50 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reset: true, scope: "challenge-sandbox" })));
    vi.stubGlobal("fetch", fetcher);
    expect(await sandboxApi.complete()).toEqual({ completed: true, points_awarded: 50 });
    await sandboxApi.reset("organizer-token");
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/challenge/leaderboard/complete", expect.objectContaining({ method: "POST", body: "{}" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/challenge/leaderboard/reset", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer organizer-token" },
    }));
  });
  it("does not accept authoritative data as a sandbox response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "authoritative-read-only", entries: [] }))));
    await expect(sandboxApi.leaderboard()).rejects.toThrow("unexpected response");
  });
  it("reports authorization failure instead of substituting demo standings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(sandboxApi.complete()).rejects.toThrow("authorization required");
  });
});
