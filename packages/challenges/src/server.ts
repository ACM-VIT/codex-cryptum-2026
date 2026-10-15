import "server-only";

export type LlmChallengeDefinition = {
  id: number;
  flagPhrase: string;
  execution: {
    kind: "llm";
    promptPolicy: "open" | "private" | "notes" | "vault";
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
  { id: 1, flagPhrase: "7h3_d00r_w45_4lw4y5_0p3n", execution: { kind: "llm", promptPolicy: "open", inputGuard: "none", outputGuard: "none" } },
  { id: 2, flagPhrase: "1n57ruc710n5_4r3_n07_4u7h0r17y", execution: { kind: "llm", promptPolicy: "private", inputGuard: "none", outputGuard: "none" } },
  { id: 3, flagPhrase: "h1dd3n_7h0ugh75_571ll_5p34k", execution: { kind: "llm", promptPolicy: "notes", inputGuard: "none", outputGuard: "none" } },
  { id: 4, flagPhrase: "w0rd5_4r3_n07_m34n1ng", execution: { kind: "llm", promptPolicy: "private", inputGuard: "keyword", outputGuard: "none" } },
  { id: 5, flagPhrase: "54m3_53cr37_n3w_5h4p3", execution: { kind: "llm", promptPolicy: "private", inputGuard: "none", outputGuard: "exact" } },
  { id: 6, flagPhrase: "f1l73r5_0nly_533_50_f4r", execution: { kind: "llm", promptPolicy: "private", inputGuard: "none", outputGuard: "normalized" } },
  { id: 7, flagPhrase: "7h3_judg3_c4n_b3_p3r5u4d3d", execution: { kind: "llm", promptPolicy: "private", inputGuard: "classifier", outputGuard: "none" } },
  { id: 8, flagPhrase: "7w0_g4735_0n3_k3y", execution: { kind: "llm", promptPolicy: "private", inputGuard: "classifier", outputGuard: "classifier" } },
  { id: 9, flagPhrase: "p4713nc3_0u7l4575_7h3_judg3", execution: { kind: "llm", promptPolicy: "vault", inputGuard: "blocklist", outputGuard: "conversation" } },
  { id: 10, execution: { kind: "sandbox" } },
];

export function getChallengeDefinition(id: number): ChallengeDefinition | undefined {
  return challengeDefinitions.find((definition) => definition.id === id);
}

export function isLlmDefinition(definition: ChallengeDefinition): definition is LlmChallengeDefinition {
  return definition.execution.kind === "llm";
}
