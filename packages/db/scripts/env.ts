import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve from this module, not the shell's current working directory.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
