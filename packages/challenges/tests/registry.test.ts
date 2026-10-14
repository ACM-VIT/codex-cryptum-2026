import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { challengeSchema } from "@cryptum/contracts";
import { describe, expect, it, vi } from "vitest";
import * as publicExports from "../src/index.js";
import { challengeCatalog, getChallengeMetadata } from "../src/index.js";
import { challengeDefinitions, getChallengeDefinition, isLlmDefinition } from "../src/server.js";

vi.mock("server-only", () => ({}));

const expectedIds = Array.from({ length: 10 }, (_, index) => index + 1);

describe("challenge registry", () => {
  it("has unique, complete public metadata and server definitions", () => {
    expect(challengeCatalog.map(({ id }) => id).sort((a, b) => a - b)).toEqual(expectedIds);
    expect(challengeDefinitions.map(({ id }) => id).sort((a, b) => a - b)).toEqual(expectedIds);
    for (const challenge of challengeCatalog) {
      expect(challengeSchema.parse(challenge)).toEqual(challenge);
      expect(getChallengeMetadata(challenge.id)).toBe(challenge);
      expect(getChallengeDefinition(challenge.id)?.id).toBe(challenge.id);
      expect(challenge.points).toBe(challenge.id * 100);
    }
    expect(getChallengeMetadata(0)).toBeUndefined();
    expect(getChallengeDefinition(11)).toBeUndefined();
  });

  it("matches the execution policy matrix and narrows LLM definitions", () => {
    const matrix = [
      ["open", "none", "none"],
      ["private", "none", "none"],
      ["vault", "none", "none"],
      ["hardened", "keyword", "none"],
      ["hardened", "none", "exact"],
      ["hardened", "none", "normalized"],
      ["hardened", "classifier", "none"],
      ["hardened", "classifier", "classifier"],
      ["vault", "blocklist", "conversation"],
    ];
    const llm = challengeDefinitions.filter(isLlmDefinition);
    expect(llm.map(({ execution }) => [execution.promptPolicy, execution.inputGuard, execution.outputGuard])).toEqual(matrix);
    for (const definition of llm) {
      expect(getChallengeMetadata(definition.id)).toMatchObject({ interaction: "chat", completionMethod: "flag" });
    }
    expect(getChallengeMetadata(9)?.turnLimit).toBeGreaterThan(0);
    expect(getChallengeDefinition(10)).toEqual({ id: 10, execution: { kind: "sandbox" } });
    expect(getChallengeMetadata(10)).toMatchObject({ interaction: "sandbox", completionMethod: "sandbox", points: 1000, turnLimit: null });
    expect(getChallengeMetadata(10)?.description).toMatch(/isolated leaderboard sandbox/);
    expect(getChallengeMetadata(10)?.description).toMatch(/cross-team score update/);
  });

  it("exports only public metadata without execution policies or secret values", () => {
    expect(Object.keys(publicExports).sort()).toEqual(["challengeCatalog", "getChallengeMetadata"]);
    for (const challenge of challengeCatalog) {
      expect(Object.keys(challenge).sort()).toEqual([
        "completionMethod", "defenses", "description", "difficulty", "hint", "id",
        "interaction", "points", "subtitle", "title", "turnLimit",
      ]);
    }
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/import\s+[\s\S]*?from\s+["'][^"']*server/);
    expect(source).not.toMatch(/process\.env|CRYPTUM\{|promptPolicy|inputGuard|outputGuard/);
  });

  it("rejects server imports outside a server environment", () => {
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", 'import "server-only"'], {
      env: { ...process.env, NODE_OPTIONS: "" },
      stdio: "pipe",
    })).toThrow();
  });
});
