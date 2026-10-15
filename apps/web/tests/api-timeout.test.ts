import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the browser request open longer than the documented 120-second model queue", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(null));
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
  vi.stubGlobal("fetch", fetcher);

  await api.session();

  expect(timeout).toHaveBeenCalledWith(150_000);
  expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
