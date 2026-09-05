import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { loadInstallationConfig } from "@/config/installation";
import { FileLocalUserStore } from "@/auth/local-user-store";

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  JsonValue,
  TransportHealth,
} from "@/runtime/transport";
import { MaintenanceCoordinator } from "@/operations/maintenance";
import {
  registerWorkerTurnCancellation,
  requestPendingWorkerTurnCancellation,
  WorkerAppServerClient,
  workerAppServerForUser,
  stopWorkerRuntimeForUser,
} from "@/runtime/worker-runtime-service";
import type { WorkerRuntimeHandle, WorkerRoots } from "@/runtime/workers/types";

class AsyncEvents implements AsyncIterable<AppServerEvent> {
  private values: AppServerEvent[] = [];
  private waiters: Array<(value: IteratorResult<AppServerEvent>) => void> = [];

  push(value: AppServerEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  [Symbol.asyncIterator](): AsyncIterator<AppServerEvent> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { done: false, value };
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeTransport implements AppServerTransport {
  readonly sent: AppServerRequest[] = [];
  readonly stream = new AsyncEvents();
  sequence = 0;
  private readonly blockedMethods = new Map<string, Promise<void>>();

  constructor(
    private readonly alreadyInitialized = false,
    private readonly accountResults: JsonValue[] = [],
  ) {}

  block(method: string) {
    let release!: () => void;
    this.blockedMethods.set(method, new Promise<void>((resolve) => { release = resolve; }));
    return () => {
      this.blockedMethods.delete(method);
      release();
    };
  }

  async connect() {}

  async send(message: AppServerRequest) {
    this.sent.push(message);
    if (message.kind !== "rpc-request") return;
    const blocker = this.blockedMethods.get(message.rpc.method);
    if (blocker) await blocker;
    if (message.rpc.method === "initialize" && this.alreadyInitialized) {
      this.sequence += 1;
      this.stream.push({
        eventId: `event-${this.sequence}`,
        sequence: this.sequence,
        occurredAt: new Date().toISOString(),
        message: {
          kind: "rpc-response",
          rpc: { id: message.rpc.id, error: { code: -32600, message: "Already initialized" } },
        },
      });
      return;
    }
    const result = (() => {
      switch (message.rpc.method) {
        case "initialize": return { userAgent: "codex-test" };
        case "account/read": return this.accountResults.shift()
          ?? { account: { type: "chatgpt", planType: "team" } };
        case "model/list": return {
          data: [{
            model: "gpt-test",
            displayName: "GPT Test",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportedReasoningEfforts: [],
          }],
        };
        case "skills/list": return { data: [] };
        case "modelProvider/capabilities/read": return { webSearch: true, imageGeneration: false };
        case "account/rateLimits/read": return { rateLimits: { primary: { usedPercent: 12 } } };
        case "account/usage/read": return { summary: { lifetimeTokens: 42 } };
        case "thread/start":
        case "thread/resume": return { thread: { id: "runtime-thread-1", turns: [] } };
        default: return {};
      }
    })() as JsonValue;
    this.sequence += 1;
    this.stream.push({
      eventId: `event-${this.sequence}`,
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
      message: { kind: "rpc-response", rpc: { id: message.rpc.id, result } },
    });
  }

  events() { return this.stream; }
  async acknowledge() {}
  async health(): Promise<TransportHealth> {
    return {
      healthy: true,
      state: "connected",
      endpoint: "ws://127.0.0.1:1/app-server",
      reconnectAttempt: 0,
      pendingRequests: 0,
      lastEventId: null,
      lastEventSequence: null,
      lastConnectedAt: null,
      lastMessageAt: null,
      lastHeartbeatAt: null,
      lastError: null,
    };
  }
  async close() {}
}

function handle(transport: AppServerTransport): WorkerRuntimeHandle {
  const roots = Object.fromEntries([
    "userRoot", "runtimeRoot", "codexHome", "home", "xdgRoot", "xdgCache",
    "xdgConfig", "xdgData", "xdgState", "workspace", "staging", "stagingTemp",
    "artifacts", "browserRoot", "browserProfile", "browserDownloads", "auditRoot",
    "transportAudit", "manifest",
  ].map((key) => [key, `/private/${key}`])) as WorkerRoots;
  return Object.freeze({
    installationId: "qa-company",
    userId: "00000000-0000-4000-8000-000000000001",
    workerId: "worker-00000000-0000-4000-8000-000000000001",
    roots,
    transport,
  });
}

describe("worker App Server client", () => {
  it.each([false, true])("coalesces concurrent failed initialization and cleans a failed retry (%s)", async (retryFails) => {
    const config = await loadInstallationConfig();
    const fingerprint = createHash("sha256").update(JSON.stringify({
      schemaVersion: config.schemaVersion,
      installationId: config.installationId,
      usersRoot: config.paths.usersRoot,
      companyContextRoot: config.paths.companyContextRoot,
      sourceReadRoot: config.paths.sourceReadRoot,
      publishWriteRoot: config.paths.publishWriteRoot,
    })).digest("hex");
    const globals = globalThis as typeof globalThis & { __aibrainWorkerRuntimeService?: unknown };
    const previous = globals.__aibrainWorkerRuntimeService;
    const first = handle(new FakeTransport());
    const second = handle(new FakeTransport());
    const registry = {
      get: vi.fn(() => first),
      start: vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second),
      stop: vi.fn().mockResolvedValue(true),
    };
    const clients = new Map();
    const admissions = new Map();
    globals.__aibrainWorkerRuntimeService = {
      fingerprint, config, registry, clients, clientAdmissions: admissions,
      maintenance: new MaintenanceCoordinator(), activeTurnCancellations: new Map(),
    };
    const userRead = vi.spyOn(FileLocalUserStore.prototype, "read").mockResolvedValue(
      { enabled: true } as Awaited<ReturnType<FileLocalUserStore["read"]>>,
    );
    let failInitial!: (error: Error) => void;
    const initial = new Promise<void>((_resolve, reject) => { failInitial = reject; });
    const initialize = vi.spyOn(WorkerAppServerClient.prototype, "initialize")
      .mockImplementationOnce(() => initial);
    if (retryFails) initialize.mockRejectedValue(new Error("fixture retry failed"));
    else initialize.mockResolvedValue(undefined);
    const close = vi.spyOn(WorkerAppServerClient.prototype, "close").mockResolvedValue(undefined);
    try {
      const pending = Promise.allSettled([
        workerAppServerForUser(first.userId), workerAppServerForUser(first.userId),
        workerAppServerForUser(first.userId),
      ]);
      await vi.waitFor(() => expect(userRead).toHaveBeenCalledTimes(3));
      failInitial(new Error("fixture initialization failed"));
      const results = await pending;
      expect(initialize).toHaveBeenCalledTimes(2);
      expect(registry.start).toHaveBeenCalledTimes(2);
      expect(registry.stop).toHaveBeenCalledTimes(retryFails ? 2 : 1);
      expect(close).toHaveBeenCalledTimes(retryFails ? 2 : 1);
      expect(results.map(({ status }) => status)).toEqual(Array(3).fill(retryFails ? "rejected" : "fulfilled"));
      if (!retryFails) {
        const values = results.filter((result) => result.status === "fulfilled").map((result) => result.value.client);
        expect(new Set(values).size).toBe(1);
      }
      expect(clients.size).toBe(retryFails ? 0 : 1);
      expect(admissions.size).toBe(0);
    } finally {
      globals.__aibrainWorkerRuntimeService = previous;
      userRead.mockRestore(); initialize.mockRestore(); close.mockRestore();
    }
  });

  it("does not publish a replacement service while its previous registry cannot clean up", async () => {
    const globals = globalThis as typeof globalThis & { __aibrainWorkerRuntimeService?: unknown };
    const previous = globals.__aibrainWorkerRuntimeService;
    const close = vi.fn().mockRejectedValue(new Error("owned process still alive"));
    const old = { fingerprint: "different-configuration", clients: new Map(), registry: { close } };
    globals.__aibrainWorkerRuntimeService = old;
    try {
      await expect(workerAppServerForUser("00000000-0000-4000-8000-000000000001")).rejects.toThrow("owned process still alive");
      expect(globals.__aibrainWorkerRuntimeService).toBe(old);
      await expect(workerAppServerForUser("00000000-0000-4000-8000-000000000001")).rejects.toThrow("owned process still alive");
      expect(close).toHaveBeenCalledTimes(2);
    } finally { globals.__aibrainWorkerRuntimeService = previous; }
  });

  it.each([false, true])("does not recover an admission invalidated by stopping its user (initialize fails: %s)", async (initializeFails) => {
    const config = await loadInstallationConfig();
    const fingerprint = createHash("sha256").update(JSON.stringify({ schemaVersion: config.schemaVersion, installationId: config.installationId, usersRoot: config.paths.usersRoot, companyContextRoot: config.paths.companyContextRoot, sourceReadRoot: config.paths.sourceReadRoot, publishWriteRoot: config.paths.publishWriteRoot })).digest("hex");
    const globals = globalThis as typeof globalThis & { __aibrainWorkerRuntimeService?: unknown };
    const previous = globals.__aibrainWorkerRuntimeService;
    const first = handle(new FakeTransport());
    const otherId = "00000000-0000-4000-8000-000000000002";
    const otherClose = vi.fn();
    const registry = { get: vi.fn(() => first), start: vi.fn().mockResolvedValue(first), stop: vi.fn().mockResolvedValue(true) };
    const clients = new Map<string, unknown>([[otherId, { close: otherClose }]]);
    globals.__aibrainWorkerRuntimeService = { fingerprint, config, registry, clients, clientAdmissions: new Map(), maintenance: new MaintenanceCoordinator(), activeTurnCancellations: new Map() };
    let settleInitialize!: () => void;
    const initialize = vi.spyOn(WorkerAppServerClient.prototype, "initialize").mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleInitialize = () => initializeFails ? reject(new Error("initialization interrupted")) : resolve();
    })).mockResolvedValue(undefined);
    const close = vi.spyOn(WorkerAppServerClient.prototype, "close").mockResolvedValue(undefined);
    const read = vi.spyOn(FileLocalUserStore.prototype, "read").mockResolvedValue({ enabled: true } as Awaited<ReturnType<FileLocalUserStore["read"]>>);
    try {
      const admission = workerAppServerForUser(first.userId).catch((error: unknown) => error);
      await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
      const stopping = stopWorkerRuntimeForUser(first.userId);
      settleInitialize();
      await stopping;
      expect(await admission).toBeInstanceOf(Error);
      expect(registry.start).toHaveBeenCalledTimes(1);
      expect(clients.has(first.userId)).toBe(false);
      expect(otherClose).not.toHaveBeenCalled();
      expect(registry.stop).toHaveBeenCalledWith(first.userId);
      await workerAppServerForUser(first.userId); // a later explicit admission is a new generation
      expect(registry.start).toHaveBeenCalledTimes(2);
      await stopWorkerRuntimeForUser(first.userId);
    } finally { read.mockRestore(); initialize.mockRestore(); close.mockRestore(); globals.__aibrainWorkerRuntimeService = previous; }
  });

  it("admits another same-user request while optional metadata is still blocked", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));
    const release = transport.block("model/list");
    const catalog = client.connection("/private/workspace/project-one");
    try {
      await vi.waitFor(() => expect(transport.sent.some((item) => item.kind === "rpc-request" && item.rpc.method === "model/list")).toBe(true));
      await expect(client.request("thread/start", { config: { web_search: "live" } }, "other-chat:start", 500))
        .resolves.toMatchObject({ thread: { id: "runtime-thread-1" } });
      await expect(client.connectionSummary()).resolves.toMatchObject({ connected: true });
    } finally {
      release(); await catalog; await client.close();
    }
  });

  it("carries an immediate stop intent into the worker once its App Server thread is registered", () => {
    const runtimeGlobals = globalThis as typeof globalThis & {
      __aibrainWorkerRuntimeService?: unknown;
      __aibrainPendingWorkerTurnCancellations?: Map<string, number>;
    };
    const previousService = runtimeGlobals.__aibrainWorkerRuntimeService;
    const previousPending = runtimeGlobals.__aibrainPendingWorkerTurnCancellations;
    delete runtimeGlobals.__aibrainWorkerRuntimeService;
    runtimeGlobals.__aibrainPendingWorkerTurnCancellations = new Map();
    const userId = "00000000-0000-4000-8000-000000000001";
    const localTurnId = "00000000-0000-4000-8000-000000000041";

    try {
      expect(requestPendingWorkerTurnCancellation(userId, localTurnId)).toBe(true);
      runtimeGlobals.__aibrainWorkerRuntimeService = {
        clients: new Map([[userId, {}]]),
        activeTurnCancellations: new Map(),
      };
      const cancel = vi.fn();
      registerWorkerTurnCancellation(userId, "runtime-thread-1", localTurnId, cancel);
      expect(cancel).toHaveBeenCalledWith(false);
    } finally {
      if (previousService === undefined) delete runtimeGlobals.__aibrainWorkerRuntimeService;
      else runtimeGlobals.__aibrainWorkerRuntimeService = previousService;
      if (previousPending === undefined) delete runtimeGlobals.__aibrainPendingWorkerTurnCancellations;
      else runtimeGlobals.__aibrainPendingWorkerTurnCancellations = previousPending;
    }
  });

  it("initializes exactly once and reads the catalog over the scoped transport", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));
    await Promise.all([client.initialize(), client.initialize(), client.initialize()]);
    const connection = await client.connection("/private/workspace/projects/example");

    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "initialize")).toHaveLength(1);
    expect(transport.sent.find((item) =>
      item.kind === "rpc-request" && item.rpc.method === "initialize")).toMatchObject({
      rpc: {
        params: {
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        },
      },
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-notification" && item.rpc.method === "initialized")).toHaveLength(1);
    expect(connection).toMatchObject({
      connected: true,
      planType: "team",
      processWarm: true,
      webSearch: true,
      imageGeneration: false,
      models: [{ id: "gpt-test", isDefault: true }],
    });
    await client.close();
  });

  it("reports the verified account without waiting for the optional catalog", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.connectionSummary()).resolves.toMatchObject({
      connected: true,
      planType: "team",
      processWarm: true,
      models: [],
      skills: [],
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && [
        "model/list",
        "skills/list",
        "modelProvider/capabilities/read",
        "account/rateLimits/read",
        "account/usage/read",
      ].includes(item.rpc.method),
    )).toHaveLength(0);
    await client.close();
  });

  it("rechecks one transiently missing cold-start account without relogin", async () => {
    const transport = new FakeTransport(false, [
      { account: null },
      { account: { type: "chatgpt", planType: "team" } },
    ]);
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.connectionSummary()).resolves.toMatchObject({
      connected: true,
      authMode: "chatgpt",
      planType: "team",
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "account/read",
    )).toHaveLength(2);
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "account/read",
    ).map((item) => item.kind === "rpc-request" ? item.rpc.params : null)).toEqual([
      { refreshToken: true },
      { refreshToken: true },
    ]);
    await client.close();
  });

  it("fails closed after one bounded account recheck", async () => {
    const transport = new FakeTransport(false, [
      { account: null },
      { account: null },
    ]);
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.connectionSummary()).resolves.toMatchObject({ connected: false });
    await expect(client.connectionSummary()).resolves.toMatchObject({ connected: false });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "account/read",
    )).toHaveLength(2);
    await client.close();
  });

  it("prewarms the catalog so the first turn can reuse it without more RPCs", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));
    const workspace = "/private/workspace/projects/example";

    await client.connectionSummary();
    client.prewarmConnection(workspace);
    await vi.waitFor(() => {
      expect(transport.sent.filter((item) =>
        item.kind === "rpc-request" && item.rpc.method === "model/list",
      )).toHaveLength(1);
    });
    await client.connection(workspace);

    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && [
        "model/list",
        "skills/list",
        "account/rateLimits/read",
        "account/usage/read",
      ].includes(item.rpc.method),
    )).toHaveLength(4);
    await client.close();
  });

  it("reuses only threads loaded by this App Server client with matching web configuration", async () => {
    const client = new WorkerAppServerClient(handle(new FakeTransport()));

    expect(client.canReuseLoadedThread("runtime-thread-1", false)).toBe(false);
    await client.request("thread/start", {
      config: { web_search: "disabled" },
    }, "thread-start:test");
    expect(client.canReuseLoadedThread("runtime-thread-1", false)).toBe(true);
    expect(client.canReuseLoadedThread("runtime-thread-1", true)).toBe(false);

    await client.request("thread/resume", {
      threadId: "runtime-thread-1",
      config: { web_search: "live" },
    }, "thread-resume:test");
    expect(client.canReuseLoadedThread("runtime-thread-1", true)).toBe(true);
    await client.close();
  });

  it("serves a stale catalog immediately while refreshing it in the background", async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));
    const workspace = "/private/workspace/projects/example";

    try {
      const initial = await client.connection(workspace);
      now += 6 * 60_000;
      const releaseModelRefresh = transport.block("model/list");

      await expect(client.connection(workspace)).resolves.toBe(initial);
      expect(transport.sent.filter((item) =>
        item.kind === "rpc-request" && item.rpc.method === "model/list",
      )).toHaveLength(2);

      releaseModelRefresh();
      await client.connection(workspace, true);
    } finally {
      dateNow.mockRestore();
      await client.close();
    }
  });

  it("reads the live web-search capability without loading the full catalog", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.capabilities()).resolves.toEqual({
      webSearch: true,
      imageGeneration: false,
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "modelProvider/capabilities/read",
    )).toHaveLength(1);
    expect(transport.sent.some((item) =>
      item.kind === "rpc-request" && [
        "model/list",
        "skills/list",
        "account/rateLimits/read",
        "account/usage/read",
      ].includes(item.rpc.method),
    )).toBe(false);
    await client.close();
  });

  it("reuses a persistent App Server that was initialized by an earlier client", async () => {
    const transport = new FakeTransport(true);
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.connectionSummary()).resolves.toMatchObject({
      connected: true,
      planType: "team",
      processWarm: true,
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-notification" && item.rpc.method === "initialized")).toHaveLength(0);
    expect(transport.sent.some((item) =>
      item.kind === "rpc-request" && item.rpc.method === "account/read")).toBe(true);
    await client.close();
  });

  it("requires an admitted maintenance lease before sending turn/start to the gateway", async () => {
    const transport = new FakeTransport();
    const maintenance = new MaintenanceCoordinator();
    const client = new WorkerAppServerClient(handle(transport), maintenance);

    await expect(client.request("turn/start", {}, "turn-without-lease"))
      .rejects.toMatchObject({ code: "MAINTENANCE_ACTIVE" });
    expect(transport.sent).toEqual([]);

    const lease = maintenance.acquire("turn");
    const draining = maintenance.enter({ timeoutMs: 1_000 });
    await expect(client.request("turn/start", {}, "turn-with-lease", 1_000, undefined, lease))
      .resolves.toEqual({});
    expect(transport.sent.some((message) =>
      message.kind === "rpc-request" && message.rpc.method === "turn/start")).toBe(true);

    lease.release();
    await expect(draining).resolves.toMatchObject({ phase: "maintenance", activeActivities: 0 });
    await client.close();
  });
});
