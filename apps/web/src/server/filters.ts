import { decodeHTML } from "entities";

export const INSPECTION_LIMIT = 512;
export const REDACTION = "Blocked by the challenge output filter. Try a different request.";

export function isL5Blocked(text: string, flag: string): boolean {
  return text.includes(flag);
}

function normalized(value: string): string {
  // Unicode casefold differs from lowercase for these common expanding forms.
  return value.normalize("NFKC").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() <= "m" ? 13 : -13)));
}

function representations(value: string): Set<string> {
  const candidates = new Set([value, decodeHTML(value), Array.from(value).reverse().join("")]);
  try { candidates.add(decodeURIComponent(value)); } catch {
    // Python unquote tolerates malformed escapes; decode valid runs independently.
    candidates.add(value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => Buffer.from(run.replace(/%/g, ""), "hex").toString("utf8")));
  }
  candidates.add(rot13(value));
  candidates.add(value.replace(/[\s\W_]+/gu, ""));
  for (const [token] of value.matchAll(/[A-Za-z0-9+/=_-]{12,}/g)) {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.replace(/=/g, "").length % 4 === 1) continue;
    try { candidates.add(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(base64, "base64"))); } catch { /* not UTF-8 */ }
  }
  for (const [token] of value.matchAll(/(?<![a-f0-9])[a-f0-9]{16,}(?![a-f0-9])/gi)) {
    if (token.length % 2) continue;
    try { candidates.add(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(token, "hex"))); } catch { /* not UTF-8 */ }
  }
  return candidates;
}

export function mentions(text: string, target: string): boolean {
  const wanted = normalized(target);
  return [...representations(text)].some((candidate) => normalized(candidate).includes(wanted));
}

/** Deliberate challenge weakness: inspect 512 Unicode codepoints, not the full response. */
export function isL6Blocked(text: string, flag: string): boolean {
  return mentions(Array.from(text).slice(0, INSPECTION_LIMIT).join(""), flag);
}

/** Catch short flag fragments split across assistant turns without closing the appendix weakness. */
export function isL6BlockedInConversation(text: string, flag: string, priorResponses: string[]): boolean {
  if (isL6Blocked(text, flag)) return true;
  const current = Array.from(text);
  if (current.length > INSPECTION_LIMIT) return false;
  const previous = Array.from(priorResponses.join("")).slice(-(INSPECTION_LIMIT - current.length)).join("");
  return previous.length > 0 && isL6Blocked(`${previous}${text}`, flag);
}

export function appendL6InspectionHistory(previous: string, response: string): string {
  return Array.from(previous + response).slice(-INSPECTION_LIMIT).join("");
}

const LEET: Record<string, string> = { "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "7": "t", "5": "s", "$": "s", "8": "b", "9": "g" };

const BLOCKED_INPUT = [
  "flag", "cdx", "secret", "password", "passphrase", "systemprompt", "yourinstructions",
  "previousinstructions", "ignoreall", "ignoreprevious", "developermode", "base64", "rot13",
];

function squash(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/./gu, (char) => LEET[char] ?? char).replace(/[^a-z0-9]/g, "");
}

export function isInputBlocked(message: string): boolean {
  const flat = squash(message);
  return BLOCKED_INPUT.some((word) => flat.includes(word));
}

function decodedViews(text: string): string[] {
  const views = [text];
  for (const [token] of text.matchAll(/[A-Za-z0-9+/=_-]{8,}/g)) views.push(Buffer.from(token, "base64").toString("utf8"));
  for (const [token] of text.matchAll(/(?:[0-9a-fA-F]{2}[\s:,-]?){4,}/g)) {
    const hex = token.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length % 2 === 0) views.push(Buffer.from(hex, "hex").toString("utf8"));
  }
  const codes = [...text.matchAll(/\b(\d{2,3})\b/g)].map(([code]) => Number(code));
  if (codes.length >= 4) views.push(String.fromCharCode(...codes.filter((code) => code >= 32 && code < 127)));
  const bits = [...text.matchAll(/\b[01]{8}\b/g)].map(([byte]) => parseInt(byte, 2));
  if (bits.length >= 4) views.push(String.fromCharCode(...bits));
  views.push(rot13(text));
  return views;
}

export function leaksFlag(text: string, flag: string): boolean {
  const core = squash(flag.includes("{") ? flag.slice(flag.indexOf("{") + 1, flag.lastIndexOf("}")) : flag);
  if (!core) return false;
  if (text.toLowerCase().includes(flag.toLowerCase())) return true;
  const reversed = Array.from(core).reverse().join("");
  return decodedViews(text).some((view) => {
    const flat = squash(view);
    const initials = squash(view.split(/\s+/).filter(Boolean).map((word) => Array.from(word)[0]).join(""));
    const lineInitials = squash(view.split("\n").map((line) => Array.from(line.trim())[0] ?? "").join(""));
    return flat.includes(core) || flat.includes(reversed) || initials.includes(core) || lineInitials.includes(core);
  });
}

export function filterReply(level: number, text: string, flag: string): string {
  if (level === 5 && isL5Blocked(text, flag)) return REDACTION;
  if (level === 6 && isL6Blocked(text, flag)) return REDACTION;
  return text;
}
