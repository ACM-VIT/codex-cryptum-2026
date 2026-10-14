import { z } from "zod";
import { sessionSchema, type Session } from "./contracts";

const key = "codex-cryptum:team-preview:v1";
const profileKey = "codex-cryptum:profile-preview:v1";
const teamSchema = z.object({
  code: z.string(),
  session: sessionSchema,
  members: z.array(z.string()),
});
function teams() {
  return z
    .array(teamSchema)
    .parse(JSON.parse(localStorage.getItem(key) ?? "[]"));
}
export function previewProfile(): string {
  try {
    return localStorage.getItem(profileKey) ?? "";
  } catch {
    return "";
  }
}
export function setPreviewProfile(name: string) {
  if (name.trim()) localStorage.setItem(profileKey, name.trim());
  else localStorage.removeItem(profileKey);
}
export function previewTeam(id: string) {
  return teams().find((team) => team.session.id === id);
}
export function savePreviewProgress(session: Session) {
  const all = teams();
  const team = all.find((item) => item.session.id === session.id);
  if (team) {
    team.session = session;
    localStorage.setItem(key, JSON.stringify(all));
  }
}
export async function createPreviewTeam(name: string, member: string) {
  const all = teams();
  const trimmed = name.trim();
  if (!member.trim()) throw new Error("Enter your name first.");
  if (trimmed.length < 2 || trimmed.length > 32)
    throw new Error("Use 2–32 characters for the team name.");
  if (
    all.some(
      (team) => team.session.teamName.toLowerCase() === trimmed.toLowerCase(),
    )
  )
    throw new Error("That team name is already in use in this preview.");
  const session: Session = {
    id: crypto.randomUUID(),
    teamName: trimmed,
    score: 0,
    solved: [],
    conversations: {},
  };
  const code = `CC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  all.push({ code, session, members: [member.trim()] });
  localStorage.setItem(key, JSON.stringify(all));
  const { activatePreviewTeam } = await import("./demo");
  return activatePreviewTeam(session);
}
export async function joinPreviewTeam(code: string, member: string) {
  if (!member.trim()) throw new Error("Enter your name first.");
  const all = teams();
  const team = all.find((item) => item.code === code.trim().toUpperCase());
  if (!team)
    throw new Error(
      "Team code not found. Use a code created in this browser’s preview.",
    );
  if (!team.members.includes(member.trim())) team.members.push(member.trim());
  localStorage.setItem(key, JSON.stringify(all));
  const { activatePreviewTeam } = await import("./demo");
  return activatePreviewTeam(team.session);
}
