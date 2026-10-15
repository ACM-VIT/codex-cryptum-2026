import "server-only";
import { z } from "zod";
import { HttpError } from "./http";

export interface GuardClassifiers {
  input(level: 7 | 8, message: string): Promise<boolean>;
  output(response: string, protectedFlag: string): Promise<boolean>;
}

const verdict = z.object({ allowed: z.boolean() }).strict();

type Payload = { challenge_id: 7 | 8; message: string } | { challenge_id: 8; response: string; protected_flag: string };

async function classify(path: string, payload: Payload): Promise<boolean> {
  const started = performance.now();
  const stage = path === "/classify-input" ? "input" : "output";
  let reason = "missing_configuration";
  try {
    const token = process.env.CRYPTUM_CLASSIFIER_TOKEN;
    const base = process.env.CRYPTUM_CLASSIFIER_URL;
    if (!token || token.length < 32 || token.length > 4096 || /[^\x21-\x7e]/.test(token) || !base) throw new Error("Missing classifier configuration");
    reason = "invalid_endpoint";
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
      throw new Error("Invalid classifier endpoint");
    }
    reason = "network_error";
    const result = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(35_000),
    });
    reason = result.status === 401 ? "authentication_failed" : "service_unavailable";
    if (!result.ok) throw new Error("Classifier unavailable");
    reason = "invalid_response";
    if (result.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("Invalid classifier response");
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
    const allowed = verdict.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).allowed;
    console.info("Classifier decision", { stage, level: payload.challenge_id, decision: allowed ? "allow" : "block", elapsedMs: Math.round(performance.now() - started) });
    return allowed;
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) reason = "timeout";
    console.warn("Classifier request failed", { stage, level: payload.challenge_id, reason, elapsedMs: Math.round(performance.now() - started) });
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
