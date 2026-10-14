import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  accessCodeHash: text("access_code_hash").notNull(),
  createdBy: text("created_by"),
  accessCodeEncrypted: text("access_code_encrypted"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("sessions_team_idx").on(table.teamId)]);

export const challenges = pgTable("challenges", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  description: text("description").notNull(),
  difficulty: text("difficulty", { enum: ["Intro", "Easy", "Medium", "Hard", "Expert"] }).notNull(),
  points: integer("points").notNull(),
  defenses: jsonb("defenses").$type<string[]>().notNull().default([]),
  hint: text("hint").notNull(),
  turnLimit: integer("turn_limit"),
  active: boolean("active").notNull().default(true),
}, (table) => [
  check("challenges_points_nonnegative", sql`${table.points} >= 0`),
  check("challenges_turn_limit_positive", sql`${table.turnLimit} IS NULL OR ${table.turnLimit} > 0`),
  check("challenges_difficulty_valid", sql`${table.difficulty} IN ('Intro', 'Easy', 'Medium', 'Hard', 'Expert')`),
]);

// Official scoring is derived only from this immutable award ledger.
export const solves = pgTable("solves", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  challengeId: integer("challenge_id").notNull().references(() => challenges.id),
  points: integer("points").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("one_solve_per_team").on(table.teamId, table.challengeId),
  check("solves_points_nonnegative", sql`${table.points} >= 0`),
]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  challengeId: integer("challenge_id").notNull().references(() => challenges.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("messages_conversation_idx").on(table.teamId, table.challengeId, table.createdAt),
  check("messages_role_valid", sql`${table.role} IN ('user', 'assistant')`),
]);

// A committed reservation survives provider failures and conversation resets.
export const chatOperations = pgTable("chat_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  challengeId: integer("challenge_id").notNull().references(() => challenges.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["pending", "completed", "failed"] }).notNull().default("pending"),
}, (table) => [
  index("chat_operations_rate_idx").on(table.teamId, table.createdAt),
  index("chat_operations_pending_idx").on(table.teamId, table.status, table.expiresAt),
  check("chat_operations_status_valid", sql`${table.status} IN ('pending', 'completed', 'failed')`),
]);

// Submitted flags must never be persisted.
export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  challengeId: integer("challenge_id").notNull().references(() => challenges.id),
  correct: boolean("correct").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("submissions_team_challenge_idx").on(table.teamId, table.challengeId)]);

// Deliberately mutable challenge scores; never join these into official scoring.
export const sandboxTeams = pgTable("sandbox_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  score: integer("score").notNull(),
});

export const exploitEvents = pgTable("exploit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorTeamId: uuid("actor_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  targetTeamId: text("target_team_id").notNull().references(() => sandboxTeams.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("exploit_events_actor_idx").on(table.actorTeamId)]);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
export type Solve = typeof solves.$inferSelect;
export type NewSolve = typeof solves.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ChatOperation = typeof chatOperations.$inferSelect;
export type NewChatOperation = typeof chatOperations.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type SandboxTeam = typeof sandboxTeams.$inferSelect;
export type NewSandboxTeam = typeof sandboxTeams.$inferInsert;
export type ExploitEvent = typeof exploitEvents.$inferSelect;
export type NewExploitEvent = typeof exploitEvents.$inferInsert;
