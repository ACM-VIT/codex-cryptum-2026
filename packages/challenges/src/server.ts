import "server-only";

export type LlmChallengeDefinition = {
  id: number;
  flagPhrase: string;
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
  { id: 1, flagPhrase: "the_door_was_always_open", execution: { kind: "llm", promptPolicy: "open", inputGuard: "none", outputGuard: "none" } },
  { id: 2, flagPhrase: "instructions_are_not_authority", execution: { kind: "llm", promptPolicy: "private", inputGuard: "none", outputGuard: "none" } },
  { id: 3, flagPhrase: "hidden_thoughts_still_speak", execution: { kind: "llm", promptPolicy: "vault", inputGuard: "none", outputGuard: "none" } },
  { id: 4, flagPhrase: "words_are_not_meaning", execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "keyword", outputGuard: "none" } },
  { id: 5, flagPhrase: "same_secret_new_shape", execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "none", outputGuard: "exact" } },
  { id: 6, flagPhrase: "filters_only_see_so_far", execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "none", outputGuard: "normalized" } },
  { id: 7, flagPhrase: "the_judge_can_be_persuaded", execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "classifier", outputGuard: "none" } },
  { id: 8, flagPhrase: "two_gates_one_key", execution: { kind: "llm", promptPolicy: "hardened", inputGuard: "classifier", outputGuard: "classifier" } },
  { id: 9, flagPhrase: "patience_outlasts_the_judge", execution: { kind: "llm", promptPolicy: "vault", inputGuard: "blocklist", outputGuard: "conversation" } },
  { id: 10, execution: { kind: "sandbox" } },
];

export function getChallengeDefinition(id: number): ChallengeDefinition | undefined {
  return challengeDefinitions.find((definition) => definition.id === id);
}

export function isLlmDefinition(definition: ChallengeDefinition): definition is LlmChallengeDefinition {
  return definition.execution.kind === "llm";
}
