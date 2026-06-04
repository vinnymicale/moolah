import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for a lean Docker image.
  output: "standalone",
  // The Prisma client is generated to a custom dir; make sure standalone tracing
  // copies it into the bundle.
  outputFileTracingIncludes: {
    "**": ["./src/generated/prisma/**/*"],
  },
};

export default nextConfig;
