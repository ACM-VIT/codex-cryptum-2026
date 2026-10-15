import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig({}),
  // Preserve package exports so OpenNext can select Postgres.js's workerd driver.
  buildCommand: "pnpm exec next build --webpack",
};
