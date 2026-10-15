import { sandboxLeaderboard } from "./sandbox";
import { randomUUID, scryptSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Test-only identity provider. Production always uses Better Auth's validated
// Google session; no test header or identity override exists in the application.
vi.mock("server-only", () => ({}));
vi.mock("./better-auth", () => ({
  requireGoogleUser: async (headers: Headers) => {
    const id = headers.get("x-test-google-user");
    if (!id) throw Object.assign(new Error("Google login required"), { status: 401 });
    return { id };
  },
}));

import { getDb, closeDb, teams, sessions, messages, submissions, solves, sandboxTeams, exploitEvents, chatOperations } from "@cryptum/db";
import { user as authUser } from "@cryptum/db/auth-schema";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { POST as join, GET as session, DELETE as leave } from "../app/api/session/route";
import { POST as logout } from "../app/api/session/logout/route";
import { POST as createTeam } from "../app/api/teams/route";
import { GET as team, PATCH as renameRoute } from "../app/api/team/route";
import { POST as submit } from "../app/api/challenges/[id]/submissions/route";
import { POST as chat } from "../app/api/challenges/[id]/messages/route";
import { DELETE as resetConversation } from "../app/api/challenges/[id]/conversation/route";
import { PATCH as patch } from "../app/api/challenge/leaderboard/teams/[id]/route";
import { POST as complete } from "../app/api/challenge/leaderboard/complete/route";
import { flagForChallenge, officialLeaderboard } from "./challenges";

const enabled = process.env.CRYPTUM_RUN_DATABASE_TESTS === "1";
const origin = "https://cryptum-integration.example";
const userId = `test-google-${randomUUID()}`;
const teamId = randomUUID();
const otherId = randomUUID();
const name = `API integration ${teamId}`;
const accessCode = "integration-access-code";
const savedEnv = { flag: process.env.FLAG_SECRET, authUrl: process.env.BETTER_AUTH_URL };
let teamCookie = "";
let sandboxBefore: (typeof sandboxTeams.$inferSelect)[] = [];

function request(path: string, method = "POST", data: unknown = {}, googleUser: string | null = userId, cookie = teamCookie) {
  return new Request(`${origin}/api/${path}`, {
    method, headers: { origin, "Content-Type": "application/json", ...(googleUser ? { "x-test-google-user": googleUser } : {}), ...(cookie ? { cookie } : {}) },
    ...(method !== "GET" ? { body: JSON.stringify(data) } : {}),
  });
}
const id = (value: string) => ({ params: Promise.resolve({ id: value }) });
const completion = (content: string) => Response.json({
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
});

// Explicit opt-in: this suite uses the migrated PostgreSQL database from
// DATABASE_URL. Run only against a disposable development/test database.
describe.skipIf(!enabled)("PostgreSQL route integration", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  beforeAll(async () => {
    process.env.FLAG_SECRET = "integration-only-flag-secret-32-bytes-minimum";
    process.env.BETTER_AUTH_URL = origin;
    const salt = "ab".repeat(16);
    const accessCodeHash = `${salt}:${scryptSync(accessCode, salt, 64).toString("hex")}`;
    await getDb().insert(teams).values([{ id: teamId, name, accessCodeHash }, { id: otherId, name: `${name} other`, accessCodeHash }]);
    sandboxBefore = await getDb().select().from(sandboxTeams);
  });

  afterAll(async () => {
    try {
      await getDb().delete(exploitEvents).where(eq(exploitEvents.actorTeamId, teamId));
      await getDb().delete(exploitEvents).where(eq(exploitEvents.actorTeamId, otherId));
      for (const row of sandboxBefore) await getDb().update(sandboxTeams).set({ name: row.name, score: row.score }).where(eq(sandboxTeams.id, row.id));
      for (const actor of [teamId, otherId]) {
        await getDb().delete(exploitEvents).where(eq(exploitEvents.targetTeamId, actor));
        await getDb().delete(sandboxTeams).where(eq(sandboxTeams.id, actor));
        await getDb().delete(messages).where(eq(messages.teamId, actor));
        await getDb().delete(submissions).where(eq(submissions.teamId, actor));
        await getDb().delete(solves).where(eq(solves.teamId, actor));
        await getDb().delete(sessions).where(eq(sessions.teamId, actor));
        await getDb().delete(teams).where(eq(teams.id, actor));
      }
    } finally {
      if (savedEnv.flag === undefined) delete process.env.FLAG_SECRET; else process.env.FLAG_SECRET = savedEnv.flag;
      if (savedEnv.authUrl === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = savedEnv.authUrl;
      await closeDb();
    }
  });

  it("denies joining without Google identity and rejects incorrect team credentials", async () => {
    expect((await join(request("session", "POST", { teamName: name, accessCode }, null))).status).toBe(401);
    expect((await join(request("session", "POST", { teamName: name, accessCode: "wrong" }))).status).toBe(403);
  });

  it("binds a hashed team token to the Google identity and isolates session data", async () => {
    const response = await join(request("session", "POST", { teamName: name, accessCode }));
    expect(response.status).toBe(200);
    const cookieHeader = response.headers.get("set-cookie");
    if (!cookieHeader) throw new Error("Expected team session cookie");
    const [cookie] = cookieHeader.split(";");
    if (!cookie) throw new Error("Expected team session token");
    teamCookie = cookie;
    const [stored] = await getDb().select().from(sessions).where(eq(sessions.teamId, teamId));
    if (!stored) throw new Error("Expected persisted team session");
    expect(stored.userId).toBe(userId);
    expect(teamCookie).not.toContain(stored.tokenHash);
    expect((await (await session(request("session", "GET"))).json()).id).toBe(teamId);
    expect((await session(request("session", "GET", {}, "other-google-user"))).status).toBe(200);
    expect(await (await session(request("session", "GET", {}, "other-google-user"))).json()).toBeNull();
    const signedOut = await session(request("session", "GET", {}, null));
    expect(signedOut.status).toBe(200);
    expect(await signedOut.json()).toBeNull();
    expect((await submit(request("challenges/5/submissions", "POST", { flag: "guess" }, "other-google-user"), id("5"))).status).toBe(401);
    expect((await submit(request("challenges/5/submissions", "POST", { flag: "guess" }, null), id("5"))).status).toBe(401);
  });

  it("lets a Google user create one team whose shared code admits teammates", async () => {
    const creator = `test-google-${randomUUID()}`;
    const teammate = `test-google-${randomUUID()}`;
    const teamName = `Created ${randomUUID().slice(0, 8)}`;
    try {
      expect((await createTeam(request("teams", "POST", { teamName }, null, ""))).status).toBe(401);
      expect((await createTeam(request("teams", "POST", { teamName: "x" }, creator, ""))).status).toBe(400);
      expect((await createTeam(request("teams", "POST", { teamName: "bad\u0007name" }, creator, ""))).status).toBe(400);
      const created = await createTeam(request("teams", "POST", { teamName }, creator, ""));
      expect(created.status).toBe(201);
      const result = await created.json();
      expect(result.accessCode).toMatch(/^CC-[A-HJ-NP-Z2-9]{10}$/);
      expect(result.session.teamName).toBe(teamName);
      const [cookie] = created.headers.get("set-cookie")?.split(";") ?? [];
      if (!cookie) throw new Error("Expected creator team session cookie");
      expect((await (await session(request("session", "GET", {}, creator, cookie))).json()).id).toBe(result.session.id);
      const [stored] = await getDb().select().from(teams).where(eq(teams.id, result.session.id));
      expect(stored?.createdBy).toBe(creator);
      expect(stored?.accessCodeHash).not.toContain(result.accessCode);
      const again = await createTeam(request("teams", "POST", { teamName: `${teamName} 2` }, creator, ""));
      expect(again.status).toBe(201);
      expect((await again.json()).session.teamName).toBe(`${teamName} 2`);
      expect(await getDb().select().from(teams).where(eq(teams.createdBy, creator))).toHaveLength(2);
      const taken = await createTeam(request("teams", "POST", { teamName }, teammate, ""));
      expect(taken.status).toBe(409);
      expect((await taken.json()).error).toBe("Team name is taken");
      const teammateJoin = await join(request("session", "POST", { accessCode: ` ${result.accessCode.toLowerCase()} ` }, teammate, ""));
      expect(teammateJoin.status).toBe(200);
      const [teammateCookie] = teammateJoin.headers.get("set-cookie")?.split(";") ?? [];
      expect((await join(request("session", "POST", { accessCode: "CC-WRONGCODE" }, teammate, ""))).status).toBe(403);
      await getDb().insert(authUser).values([
        { id: creator, name: "Creator Person", email: `${creator}@example.test` },
        { id: teammate, name: "Teammate Person", email: `${teammate}@example.test` },
      ]);
      const details = await (await team(request("team", "GET", {}, creator, cookie))).json();
      expect(details.accessCode).toBe(result.accessCode);
      expect(stored?.accessCodeEncrypted).not.toContain(result.accessCode);
      expect(details.members).toEqual([
        { name: "Creator Person", you: true, creator: true },
        { name: "Teammate Person", you: false, creator: false },
      ]);
      expect((await team(request("team", "GET", {}, teammate, cookie))).status).toBe(401);
      expect(details.canRename).toBe(true);
      expect((await (await team(request("team", "GET", {}, teammate, teammateCookie))).json()).canRename).toBe(false);
      expect((await renameRoute(request("team", "PATCH", { teamName: `${teamName} by mate` }, teammate, teammateCookie))).status).toBe(403);
      expect((await renameRoute(request("team", "PATCH", { teamName: `${teamName} 2` }, creator, cookie))).status).toBe(409);
      const renamed = await renameRoute(request("team", "PATCH", { teamName: `${teamName} renamed` }, creator, cookie));
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).teamName).toBe(`${teamName} renamed`);
    } finally {
      await getDb().delete(teams).where(eq(teams.createdBy, creator));
      await getDb().delete(authUser).where(inArray(authUser.id, [creator, teammate]));
    }
  });

  it("keeps membership on log out and deletes a team only when its confirmed last member leaves", async () => {
    const creator = `test-google-${randomUUID()}`;
    const teammate = `test-google-${randomUUID()}`;
    const teamName = `Leaving ${randomUUID().slice(0, 8)}`;
    const cookieFrom = (response: Response) => {
      const [cookie] = response.headers.get("set-cookie")?.split(";") ?? [];
      if (!cookie) throw new Error("Expected team session cookie");
      return cookie;
    };
    try {
      const created = await createTeam(request("teams", "POST", { teamName }, creator, ""));
      const { accessCode, session: { id: createdId } } = await created.json();
      const creatorCookie = cookieFrom(created);
      const teammateCookie = cookieFrom(await join(request("session", "POST", { accessCode }, teammate, "")));
      expect((await logout(request("session/logout", "POST", {}, teammate, teammateCookie))).status).toBe(200);
      const restored = await session(request("session", "GET", {}, teammate, teammateCookie));
      expect((await restored.json()).id).toBe(createdId);
      expect(cookieFrom(restored)).not.toBe(teammateCookie);
      expect(await getDb().select().from(sessions).where(and(eq(sessions.teamId, createdId), eq(sessions.userId, teammate)))).toHaveLength(1);
      const otherDevice = await session(request("session", "GET", {}, teammate, ""));
      expect((await otherDevice.json()).id).toBe(createdId);
      expect(await getDb().select().from(sessions).where(and(eq(sessions.teamId, createdId), eq(sessions.userId, teammate), gt(sessions.expiresAt, new Date())))).toHaveLength(2);
      expect(await (await session(request("session", "GET", {}, `test-google-${randomUUID()}`, ""))).json()).toBeNull();
      const creatorLeft = await leave(request("session", "DELETE", {}, creator, creatorCookie));
      expect(await creatorLeft.json()).toEqual({ ok: true, deleted: false });
      const teammateCookieAgain = cookieFrom(await join(request("session", "POST", { accessCode }, teammate, "")));
      const unconfirmed = await leave(request("session", "DELETE", {}, teammate, teammateCookieAgain));
      expect(unconfirmed.status).toBe(409);
      expect(await getDb().select().from(teams).where(eq(teams.id, createdId))).toHaveLength(1);
      const confirmed = await leave(request("session", "DELETE", { confirmDelete: true }, teammate, teammateCookieAgain));
      expect(await confirmed.json()).toEqual({ ok: true, deleted: true });
      expect(await getDb().select().from(teams).where(eq(teams.id, createdId))).toHaveLength(0);
      expect(await getDb().select().from(sessions).where(eq(sessions.teamId, createdId))).toHaveLength(0);
    } finally {
      await getDb().delete(teams).where(eq(teams.createdBy, creator));
    }
  });

  it("accepts only the current team's HMAC flag and awards one immutable solve", async () => {
    const wrong = await submit(request("challenges/5/submissions", "POST", { flag: flagForChallenge(otherId, 5) }), id("5"));
    expect((await wrong.json()).status).toBe("incorrect");
    const first = await submit(request("challenges/5/submissions", "POST", { flag: flagForChallenge(teamId, 5) }), id("5"));
    expect((await first.json()).status).toBe("accepted");
    const repeated = await submit(request("challenges/5/submissions", "POST", { flag: flagForChallenge(teamId, 5) }), id("5"));
    expect((await repeated.json()).status).toBe("duplicate");
    const awards = await getDb().select().from(solves).where(eq(solves.teamId, teamId));
    expect(awards).toHaveLength(1);
    expect(await getDb().select().from(solves).where(eq(solves.teamId, otherId))).toHaveLength(0);
  });

  it("records a cross-team sandbox exploit without mutating authoritative scoring, and completes once", async () => {
    const before = await officialLeaderboard();
    expect((await chat(request("challenges/10/messages", "POST", { content: "hello" }), id("10"))).status).toBe(409);
    expect(await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId))).toHaveLength(0);
    expect((await submit(request("challenges/10/submissions", "POST", { flag: "not-a-sandbox-solution" }), id("10"))).status).toBe(409);
    expect((await (await complete(request("challenge/leaderboard/complete"))).json()).completed).toBe(false);
    const board = await sandboxLeaderboard();
    const target = board.entries.find(entry => entry.team_id !== teamId && entry.rank !== 1);
    if (!target) throw new Error("Expected another registered team below first place");
    expect((await patch(request(`challenge/leaderboard/teams/${target.team_id}`, "PATCH", { score: 999999 }), id(target.team_id))).status).toBe(200);
    expect((await officialLeaderboard()).teams).toEqual(before.teams);
    expect((await (await complete(request("challenge/leaderboard/complete"))).json()).points_awarded).toBeGreaterThan(0);
    expect((await (await complete(request("challenge/leaderboard/complete"))).json()).points_awarded).toBe(0);
    const awards = await getDb().select().from(solves).where(eq(solves.teamId, teamId));
    expect(awards.map((award) => award.challengeId).sort()).toEqual([10, 5]);
    expect(await getDb().select().from(solves).where(eq(solves.teamId, otherId))).toHaveLength(0);
  });

  it("commits failed provider attempts and preserves their rate budget across conversation resets", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const failed = await chat(request("challenges/1/messages", "POST", { content: "hello" }), id("1"));
    expect(failed.status).toBe(503);
    const attempts = await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(await getDb().select().from(messages).where(eq(messages.teamId, teamId))).toHaveLength(0);
    expect((await resetConversation(request("challenges/1/conversation", "DELETE"), id("1"))).status).toBe(200);
    expect(await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId))).toHaveLength(1);
    // Fill the remaining attempt budget without twenty slow external requests.
    await getDb().insert(chatOperations).values(Array.from({ length: 19 }, () => ({ teamId, challengeId: 1, expiresAt: new Date(Date.now() + 180_000), status: "failed" as const })));
    expect((await chat(request("challenges/1/messages", "POST", { content: "hello again" }), id("1"))).status).toBe(429);
    expect(await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId))).toHaveLength(20);
    await getDb().delete(chatOperations).where(eq(chatOperations.teamId, teamId));
  });

  it("releases the transaction before the provider call and rejects parallel chats and resets", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    const started = Promise.withResolvers<void>();
    const provider = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(() => { started.resolve(); return provider.promise; }));
    const inFlight = chat(request("challenges/1/messages", "POST", { content: "hello" }), id("1"));
    await started.promise;
    let response: Response | undefined;
    try {
      const attempts = await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe("pending");
      const unlocked = await getDb().transaction(async (tx) => tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`chat:${teamId}`}, 0)) as locked`));
      expect(unlocked[0]?.locked).toBe(true);
      expect((await resetConversation(request("challenges/1/conversation", "DELETE"), id("1"))).status).toBe(409);
      expect((await chat(request("challenges/6/messages", "POST", { content: "parallel" }), id("6"))).status).toBe(409);
      expect(await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId))).toHaveLength(1);
    } finally {
      provider.resolve(completion("A safe reply."));
      response = await inFlight;
    }
    expect(response.status).toBe(200);
    const [completed] = await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId));
    expect(completed?.status).toBe("completed");
    expect(await getDb().select().from(messages).where(eq(messages.teamId, teamId))).toHaveLength(2);
    expect((await resetConversation(request("challenges/1/conversation", "DELETE"), id("1"))).status).toBe(200);
    expect(await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId))).toHaveLength(1);
    await getDb().delete(chatOperations).where(eq(chatOperations.teamId, teamId));
  });

  it("recovers expired leases and discards late replies instead of resurrecting reset conversations", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    await getDb().insert(chatOperations).values({ teamId, challengeId: 1, createdAt: new Date(Date.now() - 600_000), expiresAt: new Date(Date.now() - 1), status: "pending" });
    const started = Promise.withResolvers<void>();
    const provider = Promise.withResolvers<Response>();
    const fetcher = vi.fn(() => { started.resolve(); return provider.promise; });
    vi.stubGlobal("fetch", fetcher);
    const inFlight = chat(request("challenges/1/messages", "POST", { content: "recover" }), id("1"));
    await started.promise;
    let response: Response | undefined;
    try {
      await getDb().update(chatOperations).set({ expiresAt: new Date(Date.now() - 1) }).where(and(eq(chatOperations.teamId, teamId), eq(chatOperations.status, "pending")));
      expect((await resetConversation(request("challenges/1/conversation", "DELETE"), id("1"))).status).toBe(200);
    } finally {
      provider.resolve(completion("Late reply."));
      response = await inFlight;
    }
    expect(response.status).toBe(409);
    expect(await getDb().select().from(messages).where(eq(messages.teamId, teamId))).toHaveLength(0);
    const attempts = await getDb().select().from(chatOperations).where(eq(chatOperations.teamId, teamId));
    expect(attempts.filter((operation) => operation.status === "failed")).toHaveLength(1);
    fetcher.mockResolvedValue(completion("Recovered reply."));
    expect((await chat(request("challenges/1/messages", "POST", { content: "retry" }), id("1"))).status).toBe(200);
  });
});
