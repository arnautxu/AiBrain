import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = path.resolve("infra/hetzner/app/alert-controller.sh");

describe("alert controller startup policy", () => {
  it.each([undefined, "file"])("rejects missing or local-only alert delivery before collecting status: %s", async (sink) => {
    await expect(execFileAsync("/bin/sh", [script], {
      env: { NODE_ENV: "test", PATH: process.env.PATH, AIBRAIN_ALERT_INTERVAL_SECONDS: "15", AIBRAIN_ALERT_SINK: sink },
      timeout: 2_000,
    })).rejects.toMatchObject({ code: 78, stderr: expect.stringContaining("AIBRAIN_ALERT_SINK=webhook is required") });
  });

  it("rejects an absent external endpoint before collecting status", async () => {
    await expect(execFileAsync("/bin/sh", [script], {
      env: { NODE_ENV: "test", PATH: process.env.PATH, AIBRAIN_ALERT_INTERVAL_SECONDS: "15", AIBRAIN_ALERT_SINK: "webhook" },
      timeout: 2_000,
    })).rejects.toMatchObject({ code: 78, stderr: expect.stringContaining("AIBRAIN_ALERT_WEBHOOK_URL is required") });
  });
});
