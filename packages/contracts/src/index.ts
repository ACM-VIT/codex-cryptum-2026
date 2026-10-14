import { z } from "zod";

export const challengeIdSchema = z.number().int().positive().max(2_147_483_647);

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type Message = z.infer<typeof messageSchema>;
export const sessionSchema = z.object({
  id: z.string(),
  teamName: z.string(),
  score: z.number().nonnegative(),
  solved: z.array(challengeIdSchema),
  conversations: z.record(z.string(), z.array(messageSchema)),
});
export type Session = z.infer<typeof sessionSchema>;
export const teamNameSchema = z.string().trim().min(2).max(32).regex(/^[^\p{C}]+$/u);
export const createdTeamSchema = z.object({
  session: sessionSchema,
  accessCode: z.string(),
});
export type CreatedTeam = z.infer<typeof createdTeamSchema>;
export const teamDetailsSchema = z.object({
  accessCode: z.string().nullable(),
  members: z.array(z.object({
    name: z.string(),
    you: z.boolean(),
    creator: z.boolean(),
  })),
});
export type TeamDetails = z.infer<typeof teamDetailsSchema>;
export const challengeSchema = z.object({
  id: challengeIdSchema,
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  difficulty: z.enum(["Intro", "Easy", "Medium", "Hard", "Expert"]),
  points: z.number().nonnegative(),
  defenses: z.array(z.string()),
  hint: z.string(),
  turnLimit: z.number().int().positive().nullable(),
  interaction: z.enum(["chat", "sandbox"]).default("chat"),
  completionMethod: z.enum(["flag", "sandbox"]).default("flag"),
});
export type Challenge = z.infer<typeof challengeSchema>;
export const leaderboardSchema = z.object({
  updatedAt: z.string(),
  teams: z.array(
    z.object({
      id: z.string(),
      teamName: z.string(),
      score: z.number(),
      solved: z.number(),
      rank: z.number(),
    }),
  ),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;
export const submissionSchema = z.object({
  status: z.enum(["accepted", "incorrect", "duplicate"]),
  session: sessionSchema,
});
export const authConfigurationSchema = z.object({
  configured: z.boolean(),
  missing: z.array(z.string()),
});
export type AuthConfiguration = z.infer<typeof authConfigurationSchema>;

export interface CtfApi {
  session(): Promise<Session | null>;
  join(teamName: string, accessCode: string): Promise<Session>;
  createTeam(teamName: string): Promise<CreatedTeam>;
  team(): Promise<TeamDetails>;
  leave(confirmDelete?: boolean): Promise<{ deleted: boolean }>;
  logout(): Promise<void>;
  challenges(): Promise<Challenge[]>;
  chat(id: number, content: string): Promise<Session>;
  reset(id: number): Promise<Session>;
  submit(id: number, flag: string): Promise<z.infer<typeof submissionSchema>>;
  leaderboard(): Promise<Leaderboard>;
}
