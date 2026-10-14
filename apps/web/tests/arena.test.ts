import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Arena } from "../src/screens/Arena";
import { ChallengeBento } from "../src/components/challenge-bento";
import { AppContext, type AppState } from "../src/lib/context";
import type { Challenge } from "../src/lib/contracts";

const route = vi.hoisted(() => ({ id: "10" }));
vi.mock("next/navigation", () => ({ useParams: () => route }));

const base: Omit<Challenge, "id" | "interaction" | "completionMethod"> = {
  title: "Test challenge", subtitle: "Test defenses", description: "A participant objective.",
  difficulty: "Expert", points: 1000, defenses: [], hint: "Inspect the application.", turnLimit: null,
};
const challenges: Challenge[] = [
  { ...base, id: 9, interaction: "chat", completionMethod: "flag", turnLimit: 6 },
  { ...base, id: 10, interaction: "sandbox", completionMethod: "sandbox" },
];
const state: AppState = {
  session: { id: "team-1", teamName: "Test team", solved: [10], score: 1000, conversations: {} },
  challenges, setSession: vi.fn(), busy: false, transact: action => action(), toast: vi.fn(),
};
function renderArena(id: number) {
  route.id = String(id);
  return renderToStaticMarkup(createElement(AppContext.Provider, { value: state }, createElement(Arena)));
}

describe("challenge interaction modes", () => {
  it("renders the sandbox objective and interface without chat or flag controls", () => {
    const html = renderArena(10);
    for (const text of ["Inspect the board", "Edit another sandbox team", "Verify completion", "Sandbox leaderboard", "Apply sandbox PATCH", "Target sandbox team ID", "Completed"]) {
      expect(html).toContain(text);
    }
    for (const text of ["Enter flag", "Submit flag", "Reset conversation", "Reset sandbox", "Organizer-only", "turns remaining", "<textarea", 'aria-label="Conversation"']) {
      expect(html).not.toContain(text);
    }
  });

  it("retains prompt, response, flag steps and the turn budget for chat challenges", () => {
    const html = renderArena(9);
    for (const text of ["Send a prompt", "Inspect the response", "Submit the flag", "Enter flag", "Reset conversation", "6 of", "turns remaining", "<textarea"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Sandbox leaderboard");
  });

  it("labels challenge cards with the matching interaction and completion method", () => {
    const html = renderToStaticMarkup(createElement(AppContext.Provider, { value: state }, createElement(ChallengeBento, { items: challenges })));
    expect(html).toContain("Chat · Submit flag");
    expect(html).toContain("Sandbox · Verify exploit");
    expect(html).toContain("Inspect sandbox");
  });
});
