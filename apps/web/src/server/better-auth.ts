import "server-only";

import { getDb } from "@cryptum/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import * as authSchema from "@cryptum/db/auth-schema";

const requiredVariables = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "DATABASE_URL",
] as const;

export function getGoogleAuthConfiguration() {
  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

export class GoogleAuthConfigurationError extends Error {
  readonly status = 503;

  constructor() {
    super("Google sign-in is not configured. Ask the administrator to complete authentication setup.");
    this.name = "GoogleAuthConfigurationError";
  }
}

export class GoogleAuthRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super("Sign in with Google before creating or joining a team.");
    this.name = "GoogleAuthRequiredError";
  }
}

function createAuth() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret,
    BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: baseURL } = process.env;
  if (!clientId || !clientSecret || !secret || secret.length < 32 || !baseURL || !process.env.DATABASE_URL) {
    throw new GoogleAuthConfigurationError();
  }

  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
    secret,
    baseURL,
    socialProviders: { google: { clientId, clientSecret } },
    // Must be last so server actions propagate the authentication cookies.
    plugins: [nextCookies()],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

// Do not connect to PostgreSQL or require production secrets during next build.
export function getAuth() {
  return auth ??= createAuth();
}

/** Validate the Google-only auth session; never trust an identity supplied by the client. */
export async function requireGoogleUser(requestHeaders?: Headers) {
  const session = await getAuth().api.getSession({
    headers: requestHeaders ?? await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) throw new GoogleAuthRequiredError();
  return session.user;
}
