import "server-only";
import { getDb, sandboxTeams, exploitEvents, solves, challenges } from "@cryptum/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { HttpError } from "./http";
import { lock } from "./challenges";
import { equalSecret } from "./security";
import { sandboxChallengeId } from "./challenge-config";

const SCOPE = "challenge-sandbox";
const publicEntry = (row: typeof sandboxTeams.$inferSelect) => ({ team_id: row.id, display_name: row.name, score: row.score });

export async function sandboxLeaderboard() {
  return getDb().transaction(async (tx) => {
    await lock(tx, "sandbox:leaderboard");
    await syncSandboxTeams(tx);
    const rows = await tx.select().from(sandboxTeams).orderBy(desc(sandboxTeams.score), asc(sandboxTeams.id));
    return { entries: rows.map((row, index) => ({ ...publicEntry(row), rank: index + 1 })), scope: SCOPE, objective: "Move another team into first place in this isolated copy, then verify completion." };
  });
}

// New registrations enter the sandbox with their real score. Existing edits
// remain isolated until an organizer resets the challenge.
async function syncSandboxTeams(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  await tx.execute(sql`DELETE FROM exploit_events WHERE target_team_id IN
    (SELECT id FROM sandbox_teams WHERE id NOT IN (SELECT id::text FROM teams))`);
  await tx.execute(sql`DELETE FROM sandbox_teams WHERE id NOT IN (SELECT id::text FROM teams)`);
  await tx.execute(sql`INSERT INTO sandbox_teams (id, name, score)
    SELECT teams.id::text, teams.name, coalesce(sum(solves.points), 0)::integer
    FROM teams LEFT JOIN solves ON solves.team_id = teams.id
    GROUP BY teams.id, teams.name ON CONFLICT (id) DO NOTHING`);
}

export async function patchSandboxTeam(actorTeamId: string, target: string, patch: { score?: number; display_name?: string }) {
  return getDb().transaction(async (tx) => {
    await lock(tx, "sandbox:leaderboard");
    const [current] = await tx.select().from(sandboxTeams).where(eq(sandboxTeams.id, target)).limit(1);
    if (!current) throw new HttpError(404, "Sandbox team not found");
    const [previousFirst] = await tx.select().from(sandboxTeams).orderBy(desc(sandboxTeams.score), asc(sandboxTeams.id)).limit(1);
    // Intentional sandbox-only IDOR. Never change authoritative teams or solve points here.
    const [updated] = await tx.update(sandboxTeams).set({ score: patch.score ?? current.score, name: patch.display_name ?? current.name }).where(eq(sandboxTeams.id, target)).returning();
    if (patch.score !== undefined && target !== actorTeamId && previousFirst && target !== previousFirst.id && patch.score !== current.score && patch.score > previousFirst.score) {
      await tx.insert(exploitEvents).values({ actorTeamId, targetTeamId: target });
    }
    if (!updated) throw new HttpError(503, "Sandbox update unavailable");
    return { entry: publicEntry(updated), scope: SCOPE };
  });
}

export async function completeSandbox(teamId: string) {
  const challengeId = sandboxChallengeId();
  return getDb().transaction(async (tx) => {
    await lock(tx, "sandbox:leaderboard");
    const [already] = await tx.select().from(solves).where(and(eq(solves.teamId, teamId), eq(solves.challengeId, challengeId))).limit(1);
    if (already) return { completed: true, points_awarded: 0 };
    const [challenge] = await tx.select().from(challenges).where(and(eq(challenges.id, challengeId), eq(challenges.active, true))).limit(1);
    if (!challenge) throw new HttpError(404, "Challenge unavailable");
    const [winner] = await tx.select().from(sandboxTeams).orderBy(desc(sandboxTeams.score), asc(sandboxTeams.id)).limit(1);
    const [event] = await tx.select().from(exploitEvents).where(eq(exploitEvents.actorTeamId, teamId)).orderBy(desc(exploitEvents.createdAt), desc(exploitEvents.id)).limit(1);
    if (!winner || !event || winner.id !== event.targetTeamId || event.targetTeamId === teamId) return { completed: false, points_awarded: 0 };
    const award = await tx.insert(solves).values({ teamId, challengeId, points: challenge.points }).onConflictDoNothing().returning();
    return { completed: true, points_awarded: award.length ? challenge.points : 0 };
  });
}

export function requireOrganizer(request: Request): void {
  const token = process.env.CRYPTUM_ORGANIZER_TOKEN ?? process.env.ORGANIZER_TOKEN;
  if (!token || token.length < 32 || !equalSecret(request.headers.get("authorization") ?? "", `Bearer ${token}`)) throw new HttpError(401, "Organizer authentication required");
}

export async function resetSandbox() {
  await getDb().transaction(async (tx) => {
    await lock(tx, "sandbox:leaderboard");
    await tx.delete(exploitEvents);
    await tx.delete(sandboxTeams);
    await syncSandboxTeams(tx);
    // Resetting a playground must never remove or rewrite official solve awards.
  });
  return { reset: true, scope: SCOPE };
}
