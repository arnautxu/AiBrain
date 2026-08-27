import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    maxWorkers: 1,
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
