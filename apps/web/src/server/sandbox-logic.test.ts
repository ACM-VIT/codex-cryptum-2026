import { describe, expect, it } from "vitest";
import { isSandboxCompletion, shouldRecordSandboxExploit } from "./sandbox-logic";

describe("sandbox leaderboard completion", () => {
  it("records a changed cross-team score that exceeds the previous leader", () => {
    expect(shouldRecordSandboxExploit({
      actorTeamId: "actor",
      targetTeamId: "target",
      previousTargetScore: 20,
      targetScore: 101,
      previousFirstId: "leader",
      previousFirstScore: 100,
    })).toBe(true);
  });

  it("requires the participant's team to be first after a cross-team exploit", () => {
    expect(isSandboxCompletion("actor", "actor", "target")).toBe(true);
    expect(isSandboxCompletion("actor", "target", "target")).toBe(false);
  });

  it("does not count a self edit or an unrecorded ordinary ranking", () => {
    expect(shouldRecordSandboxExploit({
      actorTeamId: "actor",
      targetTeamId: "actor",
      previousTargetScore: 20,
      targetScore: 101,
      previousFirstId: "leader",
      previousFirstScore: 100,
    })).toBe(false);
    expect(isSandboxCompletion("actor", "actor", null)).toBe(false);
  });
});
