import { createHmac, hkdfSync } from "node:crypto";

export function normalizeAccessCode(code: string): string {
  const trimmed = code.trim();
  return /^cc-/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function accessCodeLookup(code: string, secret = process.env.BETTER_AUTH_SECRET): string {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 bytes");
  const key = Buffer.from(hkdfSync("sha256", secret, "", "cryptum-team-access-code-lookup-v1", 32));
  return createHmac("sha256", key).update(normalizeAccessCode(code)).digest("hex");
}
