import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.AIBRAIN_REAL_RUNTIME_BASE_URL;
if (!baseURL) throw new Error("AIBRAIN_REAL_RUNTIME_BASE_URL is required for the real runtime smoke.");

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  expect: { timeout: 120_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
