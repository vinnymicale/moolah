import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node by default: nearly every suite here tests server code, and jsdom
    // costs real startup time. Component tests opt in with a
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/lib/**/*.ts", "src/actions/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/generated/**"],
    },
  },
});
