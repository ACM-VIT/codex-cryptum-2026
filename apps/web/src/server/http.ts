import { z } from "zod";
import { challengeIdSchema } from "@cryptum/contracts";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function endpoint(fn: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await fn(request); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Better Auth's requireGoogleUser may throw an HTTP response/error.
      if (error instanceof Response) return error;
      if (error && typeof error === "object" && "status" in error && error.status === 401) return json({ error: "Authentication required" }, 401);
      if (error instanceof z.ZodError) return json({ error: "Invalid request" }, 400);
      // Never log prompts, credentials, submitted flags or provider error bodies.
      console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "Service unavailable" }, 503);
    }
  };
}

export function sameOrigin(request: Request): void {
  const configured = process.env.BETTER_AUTH_URL ?? process.env.APP_URL;
  const origin = configured ? new URL(configured).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "Cross-origin request denied");
  }
}

export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON required");
  if (Number(request.headers.get("content-length")) > 8192) throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
      chunks.push(chunk.value);
    }
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof HttpError || error instanceof z.ZodError) throw error;
    throw new HttpError(400, "Invalid JSON");
  } finally { reader.releaseLock(); }
}

export function challengeId(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new HttpError(404, "Challenge unavailable");
  const result = challengeIdSchema.safeParse(Number(value));
  if (!result.success) throw new HttpError(404, "Challenge unavailable");
  return result.data;
}
