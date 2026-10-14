"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { authConfigurationSchema, type AuthConfiguration } from "@cryptum/contracts";

type GoogleSignInProps = {
  callbackURL?: string;
  className?: string;
};

export function GoogleSignIn({ callbackURL = "/", className }: GoogleSignInProps) {
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/configuration", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check Google sign-in availability.");
        setConfiguration(authConfigurationSchema.parse(await response.json()));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Google sign-in is unavailable.");
        }
      });
    return () => controller.abort();
  }, []);

  async function signIn() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        // Only allow local destinations, not user-controlled external redirects.
        callbackURL: callbackURL.startsWith("/") && !callbackURL.startsWith("//") ? callbackURL : "/",
      });
      if (result.error) {
        setError(result.error.message ?? "Google sign-in failed. Please try again.");
      }
    } catch {
      setError("Could not connect to Google sign-in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/20 px-4 py-3 text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!configuration?.configured || pending}
        onClick={() => void signIn()}
      >
        {pending ? "Connecting to Google…" : "Continue with Google"}
      </button>
      {!configuration && !error && <output className="mt-2 block text-sm">Checking Google sign-in…</output>}
      {configuration && !configuration.configured && (
        <output className="mt-2 block text-sm">
          Google sign-in is not configured. Ask the administrator to set {configuration.missing.join(", ")}
          {" "}and register the Google OAuth redirect URI as the site URL followed by /api/auth/callback/google.
        </output>
      )}
      {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
    </div>
  );
}

export default GoogleSignIn;
