export interface SandboxScoreChange {
  actorTeamId: string;
  targetTeamId: string;
  previousTargetScore: number;
  targetScore: number;
  previousFirstId: string;
  previousFirstScore: number;
}

export function shouldRecordSandboxExploit(change: SandboxScoreChange): boolean {
  return change.targetTeamId !== change.actorTeamId
    && change.targetTeamId !== change.previousFirstId
    && change.targetScore !== change.previousTargetScore
    && change.targetScore > change.previousFirstScore;
}

export function isSandboxCompletion(
  actorTeamId: string,
  winnerTeamId: string | undefined,
  exploitedTeamId: string | null,
): boolean {
  return winnerTeamId === actorTeamId && exploitedTeamId !== null && exploitedTeamId !== actorTeamId;
}
