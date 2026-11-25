import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone output is for the Docker image (Linux); it needs symlinks, which Windows
  // dev machines often disallow.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@quantpilot/shared"],
  poweredByHeader: false,
};

export default config;
