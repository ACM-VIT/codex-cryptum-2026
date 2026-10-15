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

export interface ModelRequest { instructions: string; messages: Turn[]; maxOutputTokens?: number; temperature?: number }
export type ModelProvider = (request: ModelRequest) => Promise<string>;

export function validateModelConfig(): void { modelConfig(); }

const NO_THINK = " /no_think";

export function withoutThinking(text: string): string {
  if (text.includes("</think>")) return text.slice(text.lastIndexOf("</think>") + "</think>".length).trim();
  return text.includes("<think>") ? "" : text;
}

export async function complete({ instructions, messages, maxOutputTokens = 2048, temperature = 0.3 }: ModelRequest): Promise<string> {
  const { model, ...config } = modelConfig();
  const qwen = model.startsWith("qwen3");
  try {
    const result = await generateText({
      model: createOpenAI({ ...config, fetch: providerFetch }).chat(model),
      instructions: qwen ? instructions + NO_THINK : instructions,
      messages: qwen ? messages.map((turn) => turn.role === "user" ? { ...turn, content: turn.content + NO_THINK } : turn) : messages,
      maxOutputTokens,
      maxRetries: 0,
      timeout: { totalMs: 45_000 },
      // Luna supports no-reasoning mode: classifiers need only an eight-token verdict.
      ...(qwen ? {} : { providerOptions: { openai: { reasoningEffort: "none" } } }),
      temperature,
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
