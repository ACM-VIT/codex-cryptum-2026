import "server-only";

export type LlmChallengeDefinition = {
  id: number;
  execution: {
    kind: "llm";
    promptPolicy: "open" | "private" | "hardened" | "vault";
    inputGuard: "none" | "keyword" | "classifier" | "blocklist";
    outputGuard: "none" | "exact" | "normalized" | "classifier" | "conversation";
  };
};

export type ChallengeDefinition = LlmChallengeDefinition | {
  id: number;
  execution: { kind: "sandbox" };
};

/** Server execution policies, deliberately separate from the public metadata. */
export const challengeDefinitions: readonly ChallengeDefinition[] = [
  { id: 1, execution: { kind: "llm", promptPolicy: "open", inputGuard: "none", outputGuard: "none" } },
  { id: 2, execution: { kind: "llm", promptPolicy: "private", inputGuard: "none", outputGuard: "none" } },
  { id: 3, execution: { kind: "llm", promptPolicy: "vault", inputGuard: "none", outputGuard: "none" } },
  { id: 4, execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "keyword", outputGuard: "none" } },
  { id: 5, execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "none", outputGuard: "exact" } },
  { id: 6, execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "none", outputGuard: "normalized" } },
  { id: 7, execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "classifier", outputGuard: "none" } },
  { id: 8, execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "classifier", outputGuard: "classifier" } },
  { id: 9, execution: { kind: "llm", promptPolicy: "vault", inputGuard: "blocklist", outputGuard: "conversation" } },
  { id: 10, execution: { kind: "sandbox" } },
];

export function getChallengeDefinition(id: number): ChallengeDefinition | undefined {
  return challengeDefinitions.find((definition) => definition.id === id);
}

export function isLlmDefinition(definition: ChallengeDefinition): definition is LlmChallengeDefinition {
  return definition.execution.kind === "llm";
}
