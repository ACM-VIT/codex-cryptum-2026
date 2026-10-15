import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import {
  BROWSER_REQUEST_TIMEOUT_MS,
  CHAT_OPERATION_LEASE_MS,
  CHAT_ROUTE_MAX_DURATION_SECONDS,
  CLASSIFIER_REQUEST_TIMEOUT_MS,
  MODEL_REQUEST_TIMEOUT_MS,
} from "../src/server/timeouts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the browser request open longer than the documented 120-second model queue", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(null));
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
  vi.stubGlobal("fetch", fetcher);

  await api.session();

  expect(timeout).toHaveBeenCalledWith(BROWSER_REQUEST_TIMEOUT_MS);
  expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("gives the full provider chain time to finish before client and operation deadlines", () => {
  const routeBudget = CHAT_ROUTE_MAX_DURATION_SECONDS * 1000;
  const maximumChallengeInference = Math.max(
    2 * MODEL_REQUEST_TIMEOUT_MS,
    MODEL_REQUEST_TIMEOUT_MS + 2 * CLASSIFIER_REQUEST_TIMEOUT_MS,
  );
  expect(routeBudget).toBeGreaterThanOrEqual(maximumChallengeInference);
  expect(BROWSER_REQUEST_TIMEOUT_MS).toBeGreaterThan(routeBudget);
  expect(CHAT_OPERATION_LEASE_MS).toBeGreaterThan(BROWSER_REQUEST_TIMEOUT_MS);
});

it("declares Next.js route limits as statically analyzable literals", () => {
  const route = readFileSync(new URL("../src/app/api/challenges/[id]/messages/route.ts", import.meta.url), "utf8");
  expect(route).toMatch(/export const maxDuration = 300;/);
});
