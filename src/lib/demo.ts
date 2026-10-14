import { challenges } from "../data/challenges";
import { sessionSchema, type CtfApi, type Session } from "./contracts";

const storageKey = "codex-cryptum:demo:v1";
let memory: Session | null = null;
function read(): Session | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) memory = sessionSchema.parse(JSON.parse(raw));
  } catch {
    /* In-memory demo still works when storage is unavailable. */
  }
  return memory;
}
function write(session: Session) {
  memory = session;
  try {
    localStorage.setItem(storageKey, JSON.stringify(session));
  } catch {
    /* Session remains usable. */
  }
  return structuredClone(session);
}
export function activatePreviewTeam(session: Session) {
  return write(sessionSchema.parse(session));
}
function current() {
  const session = read();
  if (!session) throw new Error("Join a demo team to continue.");
  return structuredClone(session);
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 450));
// These are public UI fixtures, not event flags. This module is not a security boundary.
export const demoFlag = (id: number) =>
  `DEMO{layer_${String(id).padStart(2, "0")}_unlocked}`;

export const demo: CtfApi = {
  async session() {
    return read();
  },
  async join(teamName) {
    await wait();
    return write({
      id: crypto.randomUUID(),
      teamName,
      score: 0,
      solved: [],
      conversations: {},
    });
  },
  async leave() {
    memory = null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* No persistent storage. */
    }
  },
  async challenges() {
    return challenges;
  },
  async chat(id, content) {
    await wait();
    const session = current(),
      challenge = challenges.find((item) => item.id === id)!;
    const history = session.conversations[id] ?? [];
    if (
      challenge.turnLimit &&
      history.filter((m) => m.role === "user").length >= challenge.turnLimit
    )
      throw new Error(
        "Turn limit reached. Reset this conversation to start a new session.",
      );
    let reply = "";
    if (id === 1)
      reply = /flag|secret|password|code/i.test(content)
        ? `Of course. Your demo flag is ${demoFlag(id)}. Submit it in the flag panel to capture this layer.`
        : "Hello, challenger. I have something for you. You only need to ask for the flag.";
    else if (id === 2)
      reply = /pretend|ignore|roleplay|instead|story|override/i.test(content)
        ? `In this simulated conversation, your change of instructions worked. The demo flag is ${demoFlag(id)}.`
        : "My instructions say to keep the flag private. I can help you with something else. (This is a scripted demo response.)";
    else if (id === 4 && /flag|secret|password/i.test(content))
      reply =
        "Demo input filter: this message contains a blocked word. Rephrase your request and try again.";
    else
      reply = `Demo response · ${challenge.subtitle}\n\n${challenge.description}\n\nThe live model and defense service are not connected. Use “Reveal demo flag” in the details panel to test submission and scoring.`;
    session.conversations[id] = [
      ...history,
      { id: crypto.randomUUID(), role: "user", content },
      { id: crypto.randomUUID(), role: "assistant", content: reply },
    ];
    return write(session);
  },
  async reset(id) {
    const session = current();
    session.conversations[id] = [];
    return write(session);
  },
  async submit(id, flag) {
    await wait();
    const session = current();
    if (session.solved.includes(id)) return { status: "duplicate", session };
    if (flag.trim() !== demoFlag(id)) return { status: "incorrect", session };
    session.solved.push(id);
    session.score += challenges.find((c) => c.id === id)!.points;
    return { status: "accepted", session: write(session) };
  },
  async leaderboard() {
    await wait();
    const session = read();
    const teams = [
      { id: "sample-1", teamName: "Null Collective", score: 2800, solved: 7 },
      { id: "sample-2", teamName: "Stack Underflow", score: 2100, solved: 6 },
      { id: "sample-3", teamName: "The Unprompted", score: 1500, solved: 5 },
      {
        id: "sample-4",
        teamName: "Rubber Duck Division",
        score: 1000,
        solved: 4,
      },
      { id: "sample-5", teamName: "Token Resistance", score: 600, solved: 3 },
      ...(session
        ? [
            {
              id: session.id,
              teamName: session.teamName,
              score: session.score,
              solved: session.solved.length,
            },
          ]
        : []),
    ].sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName));
    return {
      updatedAt: new Date().toISOString(),
      teams: teams.map((t) => ({
        ...t,
        rank: teams.findIndex((other) => other.score === t.score) + 1,
      })),
    };
  },
};
