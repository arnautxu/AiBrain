import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ load: vi.fn(), check: vi.fn(), runtime: vi.fn() }));
vi.mock("@/config/installation", () => ({ loadInstallationConfig: mocked.load }));
vi.mock("@/operations/readiness", () => ({ checkInstallationReadiness: mocked.check }));
vi.mock("@/operations/runtime-readiness", () => ({ runtimeReadinessProbes: mocked.runtime }));

import { GET } from "@/app/api/health/ready/route";

describe("readiness route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.load.mockResolvedValue({ paths: { dataRoot: "/tmp/aibrain-readiness" } });
    mocked.runtime.mockReturnValue([]);
  });

  it("exposes a missing automation worker as a non-ready component", async () => {
    mocked.check.mockImplementation(async (_config: unknown, options: { componentProbes: Array<{ name: string; check: (signal: AbortSignal) => Promise<unknown> }> }) => {
      const worker = options.componentProbes.find((probe) => probe.name === "automations-worker");
      expect(await worker?.check(new AbortController().signal)).toEqual({ status: "unavailable", code: "AUTOMATION_WORKER_OFFLINE" });
      return { status: "degraded", components: [{ name: "automations-worker", status: "unavailable", code: "AUTOMATION_WORKER_OFFLINE" }] };
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
