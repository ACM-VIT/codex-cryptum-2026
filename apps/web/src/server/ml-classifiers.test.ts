import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mlClassifiers } from "./ml-classifiers";

beforeEach(() => {
  vi.stubEnv("CRYPTUM_CLASSIFIER_URL", "http://127.0.0.1:8091");
  vi.stubEnv("CRYPTUM_CLASSIFIER_TOKEN", "synthetic-private-transport-token-32-bytes");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([7, 8] as const)("uses independent private ML transport for level %i", async (level) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ allowed: false }));
  vi.stubGlobal("fetch", fetcher);
  expect(await mlClassifiers.input(level, "fixture")).toBe(false);
  expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8091/classify-input", expect.objectContaining({
    method: "POST", cache: "no-store", redirect: "manual",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-private-transport-token-32-bytes" },
    body: JSON.stringify({ challenge_id: level, message: "fixture" }),
  }));
});

it("passes only the current flag to output inspection and returns only the decision", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ allowed: true }));
  vi.stubGlobal("fetch", fetcher);
  expect(await mlClassifiers.output("safe response", "cdx{synthetic}")).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    challenge_id: 8, response: "safe response", protected_flag: "cdx{synthetic}",
  });
});

it.each([{}, { allowed: "true" }, { allowed: 1 }, { allowed: true, score: 0.1 }])("rejects invalid verdict %j", async (payload) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  await expect(mlClassifiers.input(7, "fixture")).rejects.toMatchObject({ status: 503, message: "Classifier unavailable" });
});

it.each([301, 302, 303, 307, 308, 401, 429, 500, 503])("fails closed on classifier HTTP %i without following redirects", async (status) => {
  const response = new Response("private-upstream-details", { status });
  const body = response.body;
  if (!body) throw new Error("Missing test response body");
  const cancel = vi.spyOn(body, "cancel");
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  await expect(mlClassifiers.input(7, "fixture")).rejects.toMatchObject({ status: 503, message: "Classifier unavailable" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["", "http://public.example", "https://user:pass@internal.example", "https://internal.example?token=secret"])("rejects invalid endpoint %s without sending a request", async (url) => {
  vi.stubEnv("CRYPTUM_CLASSIFIER_URL", url);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(mlClassifiers.input(7, "fixture")).rejects.toMatchObject({ status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects missing credentials before network activity", async () => {
  vi.stubEnv("CRYPTUM_CLASSIFIER_TOKEN", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(mlClassifiers.input(7, "fixture")).rejects.toMatchObject({ status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("sanitizes network/timeout failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-credential-flag")));
  await expect(mlClassifiers.input(8, "fixture")).rejects.toMatchObject({ status: 503, message: "Classifier unavailable" });
});

it("rejects oversized upstream responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2049))));
  await expect(mlClassifiers.input(8, "fixture")).rejects.toMatchObject({ status: 503 });
});
