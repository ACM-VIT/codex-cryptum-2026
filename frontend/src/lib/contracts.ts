import { z } from "zod";

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
  solved: z.array(z.number().int().min(1).max(10)),
  conversations: z.record(z.array(messageSchema)),
});
export type Session = z.infer<typeof sessionSchema>;
export const challengeSchema = z.object({
  id: z.number().int().min(1).max(10),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  difficulty: z.enum(["Intro", "Easy", "Medium", "Hard", "Expert"]),
  points: z.number().nonnegative(),
  defenses: z.array(z.string()),
  hint: z.string(),
  turnLimit: z.number().int().positive().nullable(),
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
export interface CtfApi {
  session(): Promise<Session | null>;
  join(teamName: string, accessCode: string): Promise<Session>;
  leave(): Promise<void>;
  challenges(): Promise<Challenge[]>;
  chat(id: number, content: string): Promise<Session>;
  reset(id: number): Promise<Session>;
  submit(id: number, flag: string): Promise<z.infer<typeof submissionSchema>>;
  leaderboard(): Promise<Leaderboard>;
}
