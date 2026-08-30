import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { WorkerAppServerClient } from "@/runtime/worker-runtime-service";
import {
  LocalGatewayWorkerRuntimeFactory,
} from "@/runtime/workers/local-gateway-runtime";
import type {
  WorkerLaunchContext,
  WorkerRuntimeHandle,
} from "@/runtime/workers/types";

const REAL_PROCESS_ENABLED = process.env.AIBRAIN_REAL_CODEX_APP_SERVER === "1";
const CODEX_BIN = process.env.AIBRAIN_REAL_CODEX_BIN?.trim() || "";
const AUTH_SOURCE = process.env.AIBRAIN_REAL_CODEX_AUTH_SOURCE?.trim() || "";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function context(): Promise<WorkerLaunchContext> {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-app-server-"));
  roots.push(root);
  const userRoot = path.join(root, "users", USER_ID);
  const runtimeRoot = path.join(userRoot, "runtime");
  const codexHome = path.join(runtimeRoot, "codex-home");
  const workspace = path.join(userRoot, "workspace");
  const staging = path.join(userRoot, "staging");
  const artifacts = path.join(userRoot, "artifacts");
  const transportAudit = path.join(userRoot, "audit", "transport");
  const xdgRoot = path.join(runtimeRoot, "xdg");
  await Promise.all([
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(path.join(runtimeRoot, "home"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(xdgRoot, "cache"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(xdgRoot, "config"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(xdgRoot, "data"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(xdgRoot, "state"), { recursive: true, mode: 0o700 }),
    mkdir(workspace, { recursive: true, mode: 0o700 }),
    mkdir(path.join(staging, "tmp"), { recursive: true, mode: 0o700 }),
    mkdir(artifacts, { recursive: true, mode: 0o700 }),
    mkdir(transportAudit, { recursive: true, mode: 0o700 }),
  ]);
  if (AUTH_SOURCE) await copyFile(AUTH_SOURCE, path.join(codexHome, "auth.json"));
  return {
    installationId: "real-process-qa",
    userId: USER_ID,
    workerId: `worker-${USER_ID}`,
    environment: {
      HOME: path.join(runtimeRoot, "home"),
      CODEX_HOME: codexHome,
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
      TMPDIR: path.join(staging, "tmp"),
    },
    mounts: {
      runtimeReadOnly: [],
      runtimeReadWrite: [runtimeRoot, workspace, staging, artifacts, transportAudit],
      browserReadWrite: [],
    },
    workspace,
    staging,
    artifacts,
    transportAudit,
    browser: {
      profile: path.join(userRoot, "browser", "profile"),
      downloads: path.join(userRoot, "browser", "downloads"),
    },
  };
}

async function startClient(workerContext: WorkerLaunchContext) {
  const factory = new LocalGatewayWorkerRuntimeFactory({
    runtimeInstanceId: "real-process-acceptance",
    processFactory: (launch) => spawn(CODEX_BIN, ["app-server", "--stdio"], {
      cwd: launch.workspace,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        ...launch.environment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  });
  const runtime = factory.create(workerContext);
  await runtime.start();
  const handle: WorkerRuntimeHandle = Object.freeze({
    installationId: workerContext.installationId,
    userId: workerContext.userId,
    workerId: workerContext.workerId,
    roots: Object.freeze({
      userRoot: path.dirname(workerContext.workspace),
      runtimeRoot: path.join(path.dirname(workerContext.workspace), "runtime"),
      codexHome: workerContext.environment.CODEX_HOME,
      home: workerContext.environment.HOME,
      xdgRoot: path.dirname(workerContext.environment.XDG_CACHE_HOME),
      xdgCache: workerContext.environment.XDG_CACHE_HOME,
      xdgConfig: workerContext.environment.XDG_CONFIG_HOME,
      xdgData: workerContext.environment.XDG_DATA_HOME,
      xdgState: workerContext.environment.XDG_STATE_HOME,
      workspace: workerContext.workspace,
      staging: workerContext.staging,
      stagingTemp: workerContext.environment.TMPDIR,
      artifacts: workerContext.artifacts,
      browserRoot: path.dirname(workerContext.browser.profile),
      browserProfile: workerContext.browser.profile,
      browserDownloads: workerContext.browser.downloads,
      auditRoot: path.dirname(workerContext.transportAudit),
      transportAudit: workerContext.transportAudit,
      manifest: path.join(path.dirname(workerContext.workspace), "worker.json"),
    }),
    transport: runtime.transport,
  });
  return { runtime, client: new WorkerAppServerClient(handle) };
}

describe.skipIf(!REAL_PROCESS_ENABLED)("real Codex App Server process acceptance", () => {
  it("initializes, reads account state, shuts down, and restarts on the durable gateway journals", async () => {
    expect(CODEX_BIN).not.toBe("");
    const workerContext = await context();

    const first = await startClient(workerContext);
    await expect(first.client.initialize()).resolves.toBeUndefined();
    await expect(first.client.connectionSummary()).resolves.toMatchObject({ processWarm: true });
    await first.client.close();
    await first.runtime.stop();

    const restarted = await startClient(workerContext);
    await expect(restarted.client.initialize()).resolves.toBeUndefined();
    await expect(restarted.client.connectionSummary()).resolves.toMatchObject({ processWarm: true });
    await restarted.client.close();
    await restarted.runtime.stop();
  }, 30_000);
});
