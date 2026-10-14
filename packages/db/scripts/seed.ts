import { randomBytes, scryptSync } from "node:crypto";
import { getDb, closeDb, challenges, teams, sandboxTeams, accessCodeLookup } from "../src/index.js";
import { requireEnv } from "./env.js";
import { challengeSeed } from "./challenges.js";

// Matches the authentication service: scrypt(code, salt, 64), stored salt:hex.
const code = requireEnv("DEV_TEAM_ACCESS_CODE");
const salt = randomBytes(16).toString("hex");
const accessCodeHash = `${salt}:${scryptSync(code, salt, 64).toString("hex")}`;
const demoTeamName = process.env.DEV_TEAM_NAME || "Demo Team";
const demoCodeLookup = accessCodeLookup(code, requireEnv("BETTER_AUTH_SECRET"));

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
    await tx.insert(teams).values({ name: demoTeamName, accessCodeHash, accessCodeLookup: demoCodeLookup })
      .onConflictDoUpdate({ target: teams.name, set: { accessCodeHash, accessCodeLookup: demoCodeLookup } });
    await tx.insert(sandboxTeams).values([
      { id: "team-aurora", name: "Aurora Labs", score: 4200 },
      { id: "team-borealis", name: "Borealis Security", score: 3300 },
      { id: "team-cipher", name: "Cipher Collective", score: 2700 },
      { id: "team-ember", name: "Ember Research", score: 1900 },
    ]).onConflictDoNothing();
  });
  console.log("Seeded 10 challenges, demo team, and PR2 sandbox teams.");
} finally {
  await closeDb();
}
