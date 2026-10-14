import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api";

const session = {
  id: "team-1",
  teamName: "Live team",
  solved: [],
  score: 0,
  conversations: {},
};

function mockResponse(data: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe("participant API boundary", () => {
  it("loads the current session with cookies and accepts no active session", async () => {
    const fetcher = mockResponse(null);
    expect(await api.session()).toBeNull();
    expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "GET", credentials: "include", signal: expect.any(AbortSignal) }));
  });

  it("joins using only the supplied team name and access code", async () => {
    const fetcher = mockResponse(session);
    expect(await api.join("Live team", "secret-code")).toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamName: "Live team", accessCode: "secret-code" }) }));
  });

  it("sends participant input to the selected challenge", async () => {
    const fetcher = mockResponse(session);
    expect(await api.chat(2, "A participant message")).toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges/2/messages", expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "A participant message" }) }));
  });

  it("resets a conversation using DELETE without a request body", async () => {
    const fetcher = mockResponse(session);
    expect(await api.reset(9)).toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges/9/conversation", expect.objectContaining({ method: "DELETE", body: undefined }));
  });

  it.each(["accepted", "incorrect", "duplicate"])("returns the server's %s submission result", async (status) => {
    const result = { status, session };
    const fetcher = mockResponse(result);
    expect(await api.submit(1, "participant-flag")).toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges/1/submissions", expect.objectContaining({ method: "POST", body: JSON.stringify({ flag: "participant-flag" }) }));
  });

  it("loads validated challenges and authoritative standings", async () => {
    const fetcher = mockResponse([]);
    expect(await api.challenges()).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges", expect.objectContaining({ method: "GET" }));
    const board = { updatedAt: "2026-10-14T00:00:00Z", teams: [] };
    fetcher.mockResolvedValue(new Response(JSON.stringify(board)));
    expect(await api.leaderboard()).toEqual(board);
    expect(fetcher).toHaveBeenCalledWith("/api/leaderboard", expect.objectContaining({ method: "GET" }));
  });

  it("preserves the server's explicit challenge interaction and completion modes", async () => {
    const base = { title: "Challenge", subtitle: "Defenses", description: "Objective", difficulty: "Expert", points: 1000, defenses: [], hint: "Inspect", turnLimit: null };
    const catalog = [
      { ...base, id: 9, interaction: "chat", completionMethod: "flag" },
      { ...base, id: 10, interaction: "sandbox", completionMethod: "sandbox" },
    ];
    mockResponse(catalog);
    expect(await api.challenges()).toEqual(catalog);
  });

  it("rejects unsupported challenge modes", async () => {
    mockResponse([{ id: 10, title: "Challenge", subtitle: "Defenses", description: "Objective", difficulty: "Expert", points: 1000, defenses: [], hint: "Inspect", turnLimit: null, interaction: "demo", completionMethod: "sandbox" }]);
    await expect(api.challenges()).rejects.toThrow("unexpected response");
  });

  it("confirms the server ended the team session", async () => {
    const fetcher = mockResponse({ ok: true });
    await expect(api.leave()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" }));
  });

  it.each([
    [401, "session has expired"],
    [403, "Access denied"],
    [409, "conversation has changed"],
    [429, "Too many requests"],
    [503, "model is unavailable"],
    [500, "request failed"],
  ])("surfaces HTTP %i without substituting local data", async (status, message) => {
    mockResponse({}, status);
    await expect(api.chat(1, "Hello")).rejects.toMatchObject({ name: "Error", status, message: expect.stringContaining(message) });
  });

  it.each([{ score: "fake" }, { ...session, solved: [0] }])("rejects invalid session data", async (data) => {
    mockResponse(data);
    await expect(api.session()).rejects.toThrow("unexpected response");
  });

  it("rejects non-JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(api.session()).rejects.toThrow("unexpected response");
  });

  it("reports a lost connection without returning fake standings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.leaderboard()).rejects.toBeInstanceOf(ApiError);
    await expect(api.leaderboard()).rejects.toThrow("Connection lost");
  });
});
