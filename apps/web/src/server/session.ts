import "server-only";
import { getDb, teams, sessions, solves, messages } from "@cryptum/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { sessionSchema, type Session } from "@cryptum/contracts";
import { requireGoogleUser } from "./better-auth";
import { digest, newToken, verifyAccessCode } from "./security";
import { HttpError } from "./http";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cryptum-team" : "cryptum-team";
const SESSION_SECONDS = 60 * 60 * 12;

function cookieToken(request: Request): string | null {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function sessionCookie(token: string, clear = false): string {
  return `${COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function currentTeam(request: Request, nullable = false): Promise<string | null> {
  const token = cookieToken(request);
  if (!token && nullable) return null;
  const user = await requireGoogleUser(request.headers);
  if (!token) throw new HttpError(401, "Team session required");
  const [session] = await getDb().select({ teamId: sessions.teamId }).from(sessions).where(and(
    eq(sessions.tokenHash, digest(token)), eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date()),
  )).limit(1);
  if (!session && !nullable) throw new HttpError(401, "Team session expired");
  return session?.teamId ?? null;
}

export async function requireTeam(request: Request): Promise<string> {
  const teamId = await currentTeam(request);
  if (!teamId) throw new HttpError(401, "Team session required");
  return teamId;
}

export async function snapshot(teamId: string): Promise<Session> {
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new HttpError(401, "Team unavailable");
  const awards = await db.select().from(solves).where(eq(solves.teamId, teamId));
  const history = await db.select().from(messages).where(eq(messages.teamId, teamId)).orderBy(asc(messages.createdAt), asc(messages.id));
  const conversations: Session["conversations"] = {};
  for (const message of history) {
    (conversations[String(message.challengeId)] ??= []).push({ id: message.id, role: message.role, content: message.content });
  }
  return sessionSchema.parse({ id: team.id, teamName: team.name, score: awards.reduce((sum, row) => sum + row.points, 0), solved: awards.map((row) => row.challengeId), conversations });
}

// Backstop for failed credential attempts; successful actions have additional DB-backed limits.
const joins = new Map<string, { count: number; reset: number }>();
function joinLimit(key: string): void {
  const now = Date.now();
  for (const [id, state] of joins) if (state.reset <= now) joins.delete(id);
  const state = joins.get(key) ?? { count: 0, reset: now + 60_000 };
  if (++state.count > 10) throw new HttpError(429, "Too many join attempts");
  joins.set(key, state);
}

export async function joinTeam(request: Request, teamName: string, accessCode: string): Promise<{ token: string; teamId: string }> {
  const user = await requireGoogleUser(request.headers);
  joinLimit(user.id);
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.name, teamName)).limit(1);
  const valid = await verifyAccessCode(accessCode, team?.accessCodeHash ?? "");
  if (!team || !valid) throw new HttpError(403, "Invalid team credentials");
  const token = newToken();
  await db.transaction(async (tx) => {
    // Rotating a team cookie cannot revoke another Google user's team session.
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), eq(sessions.teamId, team.id)));
    await tx.insert(sessions).values({ userId: user.id, teamId: team.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) });
  });
  return { token, teamId: team.id };
}

export async function leaveTeam(request: Request): Promise<void> {
  const user = await requireGoogleUser(request.headers);
  const token = cookieToken(request);
  if (token) await getDb().delete(sessions).where(and(eq(sessions.tokenHash, digest(token)), eq(sessions.userId, user.id)));
}
