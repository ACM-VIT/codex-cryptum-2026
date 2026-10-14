import "server-only";
import { challengeCatalog } from "@cryptum/challenges";
import { getChallengeDefinition } from "@cryptum/challenges/server";
import { HttpError } from "./http";

export function challengeConfig(id: number) {
  const metadata = challengeCatalog.find((challenge) => challenge.id === id);
  const definition = getChallengeDefinition(id);
  if (!metadata || !definition
    || metadata.interaction !== (definition.execution.kind === "llm" ? "chat" : "sandbox")
    || metadata.completionMethod !== (definition.execution.kind === "llm" ? "flag" : "sandbox")) {
    throw new HttpError(503, "Challenge configuration unavailable");
  }
  return { metadata, definition };
}

export function sandboxChallengeId(): number {
  const sandbox = challengeCatalog.filter((challenge) => challenge.completionMethod === "sandbox");
  const metadata = sandbox[0];
  if (sandbox.length !== 1 || !metadata) throw new HttpError(503, "Sandbox configuration unavailable");
  const { definition } = challengeConfig(metadata.id);
  if (definition.execution.kind !== "sandbox") throw new HttpError(503, "Sandbox configuration unavailable");
  return definition.id;
}
