"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin /api/auth routes; no credentials or server configuration in the bundle.
export const authClient = createAuthClient();
