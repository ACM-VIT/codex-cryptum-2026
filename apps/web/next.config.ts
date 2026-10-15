import type { NextConfig } from "next";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  transpilePackages: ["@cryptum/contracts"],
};
export default nextConfig;
