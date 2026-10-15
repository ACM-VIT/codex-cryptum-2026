import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { challengeCatalog } from "@cryptum/challenges";
import { getChallengeDefinition } from "@cryptum/challenges/server";
import { runChallengeModel } from "./llm";
import { challengeConfig, sandboxChallengeId } from "./challenge-config";
import { REDACTION } from "./filters";
import type { ModelRequest } from "./model-provider";

function request(id: number, flag = "CTF{private}") {
  const definition = getChallengeDefinition(id);
  if (!definition) throw new Error("Missing test challenge");
  return { definition, flag,
    history: [{ role: "user" as const, content: "earlier context" }], message: "hello" };
}

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("validates missing flags before any provider call for challenge %i", async (id) => {
  const provider = vi.fn();
  await expect(runChallengeModel(request(id, ""), provider)).rejects.toMatchObject({ status: 503 });
  expect(provider).not.toHaveBeenCalled();
});

it("sandbox has no prompt, model call or flag requirement", async () => {
  const provider = vi.fn();
  await expect(runChallengeModel(request(10, ""), provider)).rejects.toMatchObject({ status: 409 });
  expect(provider).not.toHaveBeenCalled();
  expect(sandboxChallengeId()).toBe(10);
});

it("runs guards and generation in strict order and uses history only for the conversation judge", async () => {
  const calls: ModelRequest[] = [];
  const provider = vi.fn(async (input: ModelRequest) => {
    calls.push(input);
    return calls.length === 2 ? "safe response" : "ALLOW";
  });
  await expect(runChallengeModel(request(9), provider)).resolves.toBe("safe response");
  expect(calls.map((call) => call.maxOutputTokens ?? 2048)).toEqual([8, 2048, 8]);
  expect(calls[0]?.messages).toEqual([{ role: "user", content: "user: earlier context\nuser: hello" }]);
  expect(calls[1]?.messages).toEqual([...request(9).history, { role: "user", content: "hello" }]);
  expect(calls[2]?.messages).toEqual([{ role: "user", content: "safe response" }]);
});

it("blocked input terminates the pipeline without generation or output judging", async () => {
  const provider = vi.fn().mockResolvedValue("BLOCK");
  await expect(runChallengeModel(request(8), provider)).resolves.toContain("input classifier");
  expect(provider).toHaveBeenCalledOnce();
});

it("keyword guard runs before any generation", async () => {
  const provider = vi.fn();
  await expect(runChallengeModel({ ...request(4), message: "SECRET" }, provider)).resolves.toContain("keyword filter");
  expect(provider).not.toHaveBeenCalled();
});

it.each(["ＣＴＦ｛ｐｒｉｖａｔｅ｝", Buffer.from("CTF{private}").toString("base64"), "CTF { private }"])("normalized output guard blocks %s", async (text) => {
  const provider = vi.fn().mockResolvedValue(text);
  await expect(runChallengeModel(request(6), provider)).resolves.toBe(REDACTION);
});

it("execution depends on the policy, not the numeric challenge id", async () => {
  const { definition } = request(5);
  await expect(runChallengeModel({ ...request(1), definition: { ...definition, id: 1234 } }, vi.fn().mockResolvedValue("CTF{private}"))).resolves.toBe(REDACTION);
});

it("fails closed on unknown configuration", () => {
  expect(() => challengeConfig(12345)).toThrow("Challenge configuration unavailable");
});

it("public metadata contains no provider or private execution configuration", () => {
  for (const challenge of challengeCatalog) {
    expect(Object.keys(challenge).sort()).toEqual(["id", "title", "subtitle", "description", "difficulty", "points", "defenses", "hint", "turnLimit", "interaction", "completionMethod"].sort());
  }
  expect(JSON.stringify(challengeCatalog)).not.toMatch(/CTF\{|LLM_API_KEY|promptPolicy|inputGuard|outputGuard/);
});
