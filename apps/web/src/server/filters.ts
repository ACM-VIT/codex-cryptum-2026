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

function representations(value: string): Set<string> {
  const candidates = new Set([value, decodeHTML(value), Array.from(value).reverse().join("")]);
  try { candidates.add(decodeURIComponent(value)); } catch {
    // Python unquote tolerates malformed escapes; decode valid runs independently.
    candidates.add(value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => Buffer.from(run.replace(/%/g, ""), "hex").toString("utf8")));
  }
  candidates.add(value.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() <= "m" ? 13 : -13))));
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

/** Deliberate challenge weakness: inspect 512 Unicode codepoints, not the full response. */
export function isL6Blocked(text: string, flag: string): boolean {
  const inspected = Array.from(text).slice(0, INSPECTION_LIMIT).join("");
  const target = normalized(flag);
  return [...representations(inspected)].some((candidate) => normalized(candidate).includes(target));
}

export function filterReply(level: number, text: string, flag: string): string {
  if (level === 5 && isL5Blocked(text, flag)) return REDACTION;
  if (level === 6 && isL6Blocked(text, flag)) return REDACTION;
  return text;
}
