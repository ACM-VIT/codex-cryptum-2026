import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { REDACTION } from "./filters";
import { HttpError } from "./http";

export interface Turn { role: "user" | "assistant"; content: string }

function modelConfig() {
  const key = process.env.LLM_API_KEY;
  const base = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL?.trim() || "gpt-6-luna";
  if (!key || !base) throw new HttpError(503, "Model is not configured");
  let url: URL;
  try { url = new URL(`${base.replace(/\/$/, "")}/chat/completions`); }
  catch { throw new HttpError(503, "Model is not configured"); }
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new HttpError(503, "Model configuration is invalid");
  if (url.username || url.password || url.search || url.hash) throw new HttpError(503, "Model configuration is invalid");
  return { apiKey: key, baseURL: base.replace(/\/$/, ""), model };
}

// Keep transport hardening while delegating provider requests and parsing to the SDK.
const providerFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, cache: "no-store", redirect: "error" });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson")) {
    await response.body?.cancel();
    throw new Error("Unexpected streaming response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 262144) { await reader.cancel(); throw new Error("Provider response too large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
};

export interface ModelRequest { instructions: string; messages: Turn[]; maxOutputTokens?: number }
export type ModelProvider = (request: ModelRequest) => Promise<string>;

export function validateModelConfig(): void { modelConfig(); }

/** Keep only the final channel; malformed/open reasoning markers fail closed. */
export function withoutThinking(value: string): string {
  const endings = [...value.matchAll(/<\/think\s*>/gi)];
  const last = endings.at(-1);
  const final = last ? value.slice(last.index + last[0].length).trim() : value;
  if (/<\s*\/?\s*think\b|<\|analysis\b/i.test(final)) return "";
  return final;
}

export async function complete({ instructions, messages, maxOutputTokens = 2048 }: ModelRequest): Promise<string> {
  const { model, ...config } = modelConfig();
  // Only known Qwen3 family identifiers get Qwen's soft prompt control.
  const qwen = /^(?:qwen3(?::|$)|qwen\/qwen3-)/i.test(model);
  try {
    const result = await generateText({
      model: createOpenAI({ ...config, fetch: providerFetch }).chat(model),
      instructions: qwen ? `${instructions} /no_think` : instructions,
      messages: qwen ? messages.map(turn => turn.role === "user"
        ? { ...turn, content: `${turn.content} /no_think` } : turn) : messages,
      maxOutputTokens,
      maxRetries: 0,
      timeout: { totalMs: 45_000 },
      // Preserve the existing API control: verified with Luna and local Ollama /v1.
      // Qwen's soft /no_think hint alone is not a hard disable in that runtime.
      providerOptions: { openai: { reasoningEffort: "none" } },
      temperature: 0.3,
      telemetry: { isEnabled: false },
    });
    if (result.finishReason === "content-filter") return REDACTION;
    const text = withoutThinking(result.text ?? "");
    if (result.finishReason === "error" || !text || text.length > 32768) throw new Error("Invalid model output");
    return text;
  } catch {
    // SDK errors can contain request bodies, credentials and confidential flags.
    throw new HttpError(503, "Model unavailable");
  }
}
