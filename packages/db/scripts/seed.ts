import { getDb, closeDb, challenges } from "../src/index.js";
import "./env.js";
import { challengeSeed } from "./challenges.js";

try {
  await getDb().transaction(async (tx) => {
    // Explicit dev seeding refreshes catalog metadata, but preserves configured
    // points, active status, and mutable sandbox progress on existing rows.
    for (const challenge of challengeSeed) {
      await tx.insert(challenges).values(challenge).onConflictDoUpdate({
        target: challenges.id,
        set: {
          title: challenge.title,
          subtitle: challenge.subtitle,
          description: challenge.description,
          difficulty: challenge.difficulty,
          defenses: challenge.defenses,
          hint: challenge.hint,
          turnLimit: challenge.turnLimit,
        },
      });
    }

  });
  console.log("Updated the challenge catalog. Teams are created by participants.");
} finally {
  await closeDb();
}
