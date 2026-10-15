import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), runChallengeModel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@cryptum/db", async (original) => ({ ...await original<object>(), getDb: mocks.getDb }));
vi.mock("./llm", () => ({ runChallengeModel: mocks.runChallengeModel }));
vi.mock("./session", () => ({ snapshot: vi.fn() }));
import { challengeCatalog } from "@cryptum/challenges";
import { catalog, sendMessage } from "./challenges";

beforeEach(() => { vi.resetAllMocks(); });

it("rejects sandbox chat before database reservations or model execution", async () => {
  await expect(sendMessage("team", 10, "hello")).rejects.toMatchObject({ status: 409 });
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.runChallengeModel).not.toHaveBeenCalled();
});

it("fails closed on unregistered chat", async () => {
  await expect(sendMessage("team", 12345, "hello")).rejects.toMatchObject({ status: 503 });
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.runChallengeModel).not.toHaveBeenCalled();
});

function mockCatalog(rows: object[]) {
  mocks.getDb.mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) });
}

it("enriches catalog records with registry interaction without overriding database points", async () => {
  mockCatalog(challengeCatalog.map(({ hidden: _hidden, ...challenge }) => ({ ...challenge, points: 42, interaction: undefined, completionMethod: undefined })));
  const result = await catalog();
  expect(result.map((challenge) => challenge.points)).toEqual(Array(9).fill(42));
  expect(result.map((challenge) => challenge.id)).not.toContain(10);
  expect(result[0]).toMatchObject({ interaction: "chat", completionMethod: "flag" });
  expect(JSON.stringify(result)).not.toMatch(/sandbox|hidden/);
  expect(JSON.stringify(result)).not.toMatch(/execution|promptPolicy|cdx\{|LLM_API_KEY/);
});

it("does not silently default unknown database records to chat", async () => {
  mockCatalog([{ ...challengeCatalog[0], id: 12345 }]);
  await expect(catalog()).rejects.toMatchObject({ status: 503 });
});
