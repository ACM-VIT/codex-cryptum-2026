import { afterEach, describe, expect, it, vi } from "vitest";
import { getGoogleAuthConfiguration } from "./better-auth";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

describe("Google sign-in configuration", () => {
  it("reports an undersized auth secret as invalid configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short");
    vi.stubEnv("BETTER_AUTH_URL", "https://cryptum.example");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/db");

    expect(getGoogleAuthConfiguration()).toEqual({
      configured: false,
      missing: ["BETTER_AUTH_SECRET"],
    });
  });

  it("accepts a complete configuration with a sufficiently long secret", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("BETTER_AUTH_URL", "https://cryptum.example");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/db");

    expect(getGoogleAuthConfiguration()).toEqual({ configured: true, missing: [] });
  });
});
