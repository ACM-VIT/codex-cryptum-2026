import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLiveRefresh } from "../src/lib/live-refresh";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("refreshes immediately and periodically, then stops on cleanup", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const stop = startLiveRefresh(refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(6000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("does not overlap requests and refreshes immediately on reconnect", async () => {
  let finish!: () => void;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const stop = startLiveRefresh(refresh);
  await vi.advanceTimersByTimeAsync(9000);
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event("online"));
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});
