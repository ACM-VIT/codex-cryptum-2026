import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function equalSecret(actual: string, expected: string): boolean {
  // Hash first so even unequal-length inputs take the same comparison path.
  return timingSafeEqual(Buffer.from(digest(actual), "hex"), Buffer.from(digest(expected), "hex"));
}

export async function verifyAccessCode(code: string, stored: string): Promise<boolean> {
  const match = /^([a-f0-9]{32,128}):([a-f0-9]{128})$/i.exec(stored);
  // Run scrypt even for an unknown team / invalid stored hash.
  const salt = match?.[1] ?? "00000000000000000000000000000000";
  const derived = await scrypt(code, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(match?.[2] ?? "0".repeat(128), "hex")) && !!match;
}

export function flagFor(teamId: string, challengeId: number, secret = process.env.FLAG_SECRET): string {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("FLAG_SECRET must have at least 32 bytes");
  const mac = createHmac("sha256", secret).update(`ctf-v1:${teamId}:${challengeId}`).digest("hex");
  return `cdx{${mac}}`;
}
