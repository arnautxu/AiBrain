import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  connectionSummary: vi.fn(),
  capabilities: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({
    tenant: { id: "arnall-qa", name: "Arnall" },
    user: { id: "00000000-0000-4000-8000-000000000001" },
  })),
}));
vi.mock("@/runtime/config", () => ({
  readRuntimeConfig: vi.fn(() => ({
    mode: "codex",
    workspace: "/tmp/aibrain-runtime-status-route",
    model: null,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  })),
}));
vi.mock("@/runtime/worker-runtime-service", () => ({
  workerAppServerForUser: vi.fn(async () => ({
    handle: { roots: { workspace: "/tmp/aibrain-runtime-status-route" } },
    client: {
      connectionSummary: mocked.connectionSummary,
      capabilities: mocked.capabilities,
    },
  })),
}));
vi.mock("@/runtime/workers/provisioner", () => ({
  resolveWorkerOwnedPath: vi.fn(async (_root: string, relativePath: string) =>
    `/tmp/aibrain-runtime-status-route/${relativePath}`),
}));
vi.mock("@/workbench/store", () => ({
  getProjectRuntimeContext: vi.fn(),
  isBrowserPreviewWorkbench: vi.fn(() => false),
}));

import { GET } from "@/app/api/runtime/status/route";

describe("runtime status capability exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.connectionSummary.mockResolvedValue({
      connected: true,
      authMode: "chatgpt",
      planType: "team",
      models: [],
      skills: [],
      webSearch: false,
      imageGeneration: false,
      processWarm: true,
      rateLimit: null,
      usage: null,
    });
    mocked.capabilities.mockResolvedValue({ webSearch: true, imageGeneration: false });
  });

  it("keeps a ready Arnall Codex runtime web-enabled for a current-hours search", async () => {
    const response = await GET(new Request("http://localhost/api/runtime/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      codex: "connected",
      ready: true,
      capabilities: { webSearch: true },
    });
    expect(mocked.capabilities).toHaveBeenCalledOnce();
  });
});
