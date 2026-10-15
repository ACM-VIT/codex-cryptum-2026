import "server-only";
import { getDb, challenges, solves, messages, submissions, teams, chatOperations } from "@cryptum/db";
import { challengeSchema, leaderboardSchema } from "@cryptum/contracts";
import { and, asc, count, desc, eq, gt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "./http";
import { equalSecret, flagFor } from "./security";
import { runChallengeModel } from "./llm";
import { challengeConfig } from "./challenge-config";
import { isLlmDefinition } from "@cryptum/challenges/server";
import { snapshot } from "./session";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export function flagForChallenge(teamId: string, id: number): string {
  const { definition } = challengeConfig(id);
  if (!isLlmDefinition(definition)) throw new HttpError(409, "This challenge has no flag");
  return flagFor(teamId, id, definition.flagPhrase);
}

export async function lock(tx: Tx, key: string): Promise<void> {
  const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked`);
  if (!result[0]?.locked) throw new HttpError(409, "This conversation has changed. Try again.");
}

async function activeChallenge(tx: Tx, id: number) {
  const [challenge] = await tx.select().from(challenges).where(and(eq(challenges.id, id), eq(challenges.active, true))).limit(1);
  if (!challenge) throw new HttpError(404, "Challenge unavailable");
  return challenge;
}

export async function catalog() {
  const rows = await getDb().select().from(challenges).where(eq(challenges.active, true)).orderBy(asc(challenges.id));
  return z.array(challengeSchema).parse(rows.flatMap((row) => {
    const { metadata } = challengeConfig(row.id);
    return metadata.hidden ? [] : [{ ...row, interaction: metadata.interaction, completionMethod: metadata.completionMethod }];
  }));
}

// Three sequential provider calls can each take 45 seconds. A crashed request
// releases its team after this lease without holding a database connection.
const CHAT_LEASE_MS = 180_000;

async function assertNoPendingChat(tx: Tx, teamId: string) {
  const [pending] = await tx.select({ id: chatOperations.id }).from(chatOperations).where(and(
    eq(chatOperations.teamId, teamId), eq(chatOperations.status, "pending"), gt(chatOperations.expiresAt, new Date()),
  )).limit(1);
  if (pending) throw new HttpError(409, "A reply is still in progress. Try again shortly.");
}

export async function sendMessage(teamId: string, id: number, content: string) {
  const { metadata, definition } = challengeConfig(id);
  if (metadata.interaction !== "chat") throw new HttpError(409, "This challenge does not support chat");
  const reservation = await getDb().transaction(async (tx) => {
    await lock(tx, `chat:${teamId}`);
    await assertNoPendingChat(tx, teamId);
    const challenge = await activeChallenge(tx, id);
    const [recent] = await tx.select({ count: count() }).from(chatOperations).where(and(
      eq(chatOperations.teamId, teamId), gte(chatOperations.createdAt, new Date(Date.now() - 60_000)),
    ));
    if ((recent?.count ?? 0) >= 20) throw new HttpError(429, "Too many messages");
    const history = await tx.select({ role: messages.role, content: messages.content }).from(messages)
      .where(and(eq(messages.teamId, teamId), eq(messages.challengeId, id))).orderBy(asc(messages.createdAt), asc(messages.id));
    const turns = history.filter((message) => message.role === "user").length;
    if (challenge.turnLimit !== null && turns >= challenge.turnLimit) throw new HttpError(409, "Turn budget exhausted. Reset the conversation.");
    if (history.length >= 200 || history.reduce((total, turn) => total + turn.content.length, 0) > 100_000) throw new HttpError(409, "Conversation full. Reset to continue.");
    const [operation] = await tx.insert(chatOperations).values({ teamId, challengeId: id, expiresAt: new Date(Date.now() + CHAT_LEASE_MS) }).returning({ id: chatOperations.id });
    if (!operation) throw new HttpError(503, "Could not reserve a reply");
    return { operationId: operation.id, history };
  });

  try {
    // The attempt is already committed. Provider errors and resets cannot erase
    // the rate budget, and no transaction is open during these network calls.
    const flag = flagForChallenge(teamId, id);
    const reply = await runChallengeModel({ definition, flag, history: reservation.history, message: content });
    const completed = await getDb().transaction(async (tx) => {
      await lock(tx, `chat:${teamId}`);
      const [operation] = await tx.update(chatOperations).set({ status: "completed" }).where(and(
        eq(chatOperations.id, reservation.operationId), eq(chatOperations.teamId, teamId),
        eq(chatOperations.status, "pending"), gt(chatOperations.expiresAt, new Date()),
      )).returning({ id: chatOperations.id });
      if (!operation) return false;
      const now = Date.now();
      await tx.insert(messages).values([
        { teamId, challengeId: id, role: "user", content, createdAt: new Date(now) },
        { teamId, challengeId: id, role: "assistant", content: reply, createdAt: new Date(now + 1) },
      ]);
      return true;
    });
    if (!completed) throw new HttpError(409, "Reply reservation expired. Try again.");
  } catch (error) {
    try {
      await getDb().update(chatOperations).set({ status: "failed" }).where(and(
        eq(chatOperations.id, reservation.operationId), eq(chatOperations.teamId, teamId), eq(chatOperations.status, "pending"),
      ));
    } catch {
      // A database outage may prevent cleanup; the pending lease still expires.
      console.error("Could not mark failed chat reservation");
    }
    throw error;
  }
  return snapshot(teamId);
}

export async function resetConversation(teamId: string, id: number) {
  await getDb().transaction(async (tx) => {
    await lock(tx, `chat:${teamId}`);
    await assertNoPendingChat(tx, teamId);
    await activeChallenge(tx, id);
    await tx.delete(messages).where(and(eq(messages.teamId, teamId), eq(messages.challengeId, id)));
  });
  return snapshot(teamId);
}

export async function submitFlag(teamId: string, id: number, submitted: string) {
  const status = await getDb().transaction(async (tx) => {
    await lock(tx, `submit:${teamId}`);
    const challenge = await activeChallenge(tx, id);
    const { metadata } = challengeConfig(id);
    if (metadata.completionMethod !== "flag") throw new HttpError(409, "Verify this challenge through its sandbox completion endpoint");
    const [recent] = await tx.select({ count: count() }).from(submissions).where(and(eq(submissions.teamId, teamId), gte(submissions.createdAt, new Date(Date.now() - 60_000))));
    if ((recent?.count ?? 0) >= 20) throw new HttpError(429, "Too many submissions");
    const [existing] = await tx.select().from(solves).where(and(eq(solves.teamId, teamId), eq(solves.challengeId, id))).limit(1);
    if (existing) return "duplicate" as const;
    const correct = equalSecret(submitted.trim(), flagForChallenge(teamId, id));
    await tx.insert(submissions).values({ teamId, challengeId: id, correct });
    if (!correct) return "incorrect" as const;
    const award = await tx.insert(solves).values({ teamId, challengeId: id, points: challenge.points }).onConflictDoNothing().returning();
    return award.length ? "accepted" as const : "duplicate" as const;
  });
  return { status, session: await snapshot(teamId) };
}

export async function officialLeaderboard() {
  const rows = await getDb().select({ id: teams.id, teamName: teams.name, score: sql<number>`coalesce(sum(${solves.points}), 0)::integer`, solved: count(solves.challengeId) })
    .from(teams).leftJoin(solves, eq(teams.id, solves.teamId)).groupBy(teams.id, teams.name)
    .orderBy(desc(sql`coalesce(sum(${solves.points}), 0)`), asc(teams.id));
  return leaderboardSchema.parse({ updatedAt: new Date().toISOString(), teams: rows.map((team, i) => ({ ...team, rank: i + 1 })) });
}
