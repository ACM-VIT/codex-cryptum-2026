import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "4ee36e42cabfd44e8ce61b2a6bd637c5",
  worker: {
    name: "codex-cryptum-2026",
    compatibilityDate: "2026-10-15",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    entrypoint: "../../apps/web/.open-next/worker.js",
    observability: { enabled: true },
    domains: ["codex.acmvit.in"],
    env: {
      ASSETS: bindings.assets(),
      HYPERDRIVE: bindings.hyperdrive({ id: "000c34fad7c94339bb78e717ee9445be" }),
      CRYPTUM_DATABASE_MODE: bindings.text("hyperdrive"),
    },
  },
});
