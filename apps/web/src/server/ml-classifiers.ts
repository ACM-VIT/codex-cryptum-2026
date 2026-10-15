import "server-only";
import { z } from "zod";
import { HttpError } from "./http";
import { CLASSIFIER_REQUEST_TIMEOUT_MS } from "./timeouts";

export interface GuardClassifiers {
  input(level: 7 | 8, message: string): Promise<boolean>;
  output(response: string, protectedFlag: string): Promise<boolean>;
}

const verdict = z.object({ allowed: z.boolean() }).strict();

async function classify(path: string, payload: object): Promise<boolean> {
  try {
    const token = process.env.CRYPTUM_CLASSIFIER_TOKEN;
    const base = process.env.CRYPTUM_CLASSIFIER_URL;
    if (!token || Buffer.byteLength(token) < 32 || !base) throw new Error("Missing classifier configuration");
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
      throw new Error("Invalid classifier endpoint");
    }
    const result = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(CLASSIFIER_REQUEST_TIMEOUT_MS),
    });
    if (!result.ok) throw new Error("Classifier unavailable");
    const reader = result.body?.getReader();
    if (!reader) throw new Error("Missing classifier response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); throw new Error("Invalid classifier response"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return verdict.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).allowed;
  } catch {
    // Neither upstream diagnostics, current-team flags nor transport credentials escape.
    throw new HttpError(503, "Classifier unavailable");
  }
}

export const mlClassifiers: GuardClassifiers = {
  input: (level, message) => classify("/classify-input", { challenge_id: level, message }),
  output: (response, protectedFlag) => classify("/classify-output", {
    challenge_id: 8, response, protected_flag: protectedFlag,
  }),
};
