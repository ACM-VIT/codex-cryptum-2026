import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function equalSecret(actual: string, expected: string): boolean {
  // Hash first so even unequal-length inputs take the same comparison path.
  return timingSafeEqual(Buffer.from(digest(actual), "hex"), Buffer.from(digest(expected), "hex"));
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newAccessCode = () => `CC-${Array.from(randomBytes(10), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")}`;

export async function hashAccessCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(code, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

function accessCodeKey(secret = process.env.BETTER_AUTH_SECRET): Buffer {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 bytes");
  return Buffer.from(hkdfSync("sha256", secret, "", "cryptum-team-access-code-v1", 32));
}

export function encryptAccessCode(code: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", accessCodeKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptAccessCode(stored: string | null, secret?: string): string | null {
  const parts = stored?.split(":");
  if (!parts || parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", accessCodeKey(secret), Buffer.from(parts[1] ?? "", "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2] ?? "", "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3] ?? "", "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
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
  return `CTF{${mac}}`;
}
