import { afterEach, expect, it } from "vitest";
import { closeDb, getDb, withDatabase } from "@cryptum/db";

afterEach(() => closeDb());

it("isolates concurrent Worker requests while reusing each request's client", async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let first: ReturnType<typeof getDb> | undefined;
  await Promise.all([
    withDatabase("postgresql://example.invalid/first", async () => {
      first = getDb();
      release();
      await Promise.resolve();
      expect(getDb()).toBe(first);
    }),
    withDatabase("postgresql://example.invalid/second", async () => {
      await ready;
      expect(getDb()).not.toBe(first);
    }),
  ]);
});

it("clears the request's database context after failures", async () => {
  let failed: ReturnType<typeof getDb> | undefined;
  await expect(withDatabase("postgresql://example.invalid/db", async () => {
    failed = getDb();
    throw new Error("request failed");
  })).rejects.toThrow("request failed");
  await withDatabase("postgresql://example.invalid/db", async () => {
    expect(getDb()).not.toBe(failed);
  });
});
