import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Emit a self-contained server bundle (.next/standalone) for the Docker image.
  // Vercel must not build in standalone mode: it skips the top-level .nft.json
  // trace manifests its packager reads, and the deploy fails looking for
  // next-server.js.nft.json.
  output: process.env.VERCEL ? undefined : "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
