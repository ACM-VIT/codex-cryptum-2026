import { challengeCatalog } from "@cryptum/challenges";
import type { NewChallenge } from "../src/schema.js";

// Interaction and completion are registry concerns, not database columns.
export const challengeSeed: NewChallenge[] = challengeCatalog.map((challenge) => ({
  id: challenge.id,
  title: challenge.title,
  subtitle: challenge.subtitle,
  difficulty: challenge.difficulty,
  points: challenge.points,
  description: challenge.description,
  defenses: challenge.defenses,
  hint: challenge.hint,
  turnLimit: challenge.turnLimit,
}));
