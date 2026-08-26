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
    // Filesystem durability and real gateway tests intentionally exercise
    // fsync/locks. Serialize test files so small QA machines do not starve
    // their unchanged 5 s safety thresholds; focused suites still exercise
    // concurrent users, turns, locks, gateways, and worker runtimes in-process.
    maxWorkers: 1,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
