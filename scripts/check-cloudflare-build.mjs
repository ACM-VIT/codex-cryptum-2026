import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../apps/web/.open-next/server-functions/default/apps/web/handler.mjs", import.meta.url), "utf8");
assert.ok(bundle.includes('endsWith("/server/preview-props.json")'), "OpenNext must inline the Next.js preview-props manifest");
assert.ok(bundle.includes("Unexpected loadManifest("), "Unknown manifests must still fail closed");
console.log("Cloudflare manifest checks passed.");
