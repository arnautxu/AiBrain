import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseInstallationConfig, type InstallationConfig } from "@/config/installation-schema";
import { MaintenanceCoordinator } from "@/operations/maintenance";
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  TransportHealth,
} from "@/runtime/transport";
import {
  buildWorkerLaunchContext,
  deriveWorkerRoots,
  resolveWorkerOwnedPath,
  WorkerProvisioner,
  WorkerProvisioningError,
} from "@/runtime/workers/provisioner";
import {
  WorkerRegistryBackpressureError,
  WorkerRuntimeRegistry,
} from "@/runtime/workers/registry";
import type {
  ManagedWorkerRuntime,
  WorkerLaunchContext,
  WorkerRuntimeFactory,
} from "@/runtime/workers/types";

const temporaryRoots: string[] = [];

function syntheticUser(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-workers-"));
  temporaryRoots.push(root);
  const config = parseInstallationConfig({
    schemaVersion: 1,
    installationId: "workers-qa",
    companyName: "Workers QA",
    companySlug: "workers-qa",
    publicUrl: "http://127.0.0.1:3000",
    branding: {
      productName: "Workers QA Brain",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      accentColor: "#3366ff",
    },
    paths: {
      dataRoot: path.join(root, "data"),
      companyContextRoot: path.join(root, "data", "company"),
      usersRoot: path.join(root, "data", "users"),
      sourceReadRoot: path.join(root, "documents", "source-ro"),
      publishWriteRoot: path.join(root, "documents", "publish-rw"),
      backupsRoot: path.join(root, "data", "backups"),
    },
  });
  await Promise.all([
    mkdir(config.paths.companyContextRoot, { recursive: true }),
    mkdir(config.paths.sourceReadRoot, { recursive: true }),
    mkdir(config.paths.publishWriteRoot, { recursive: true }),
  ]);
  return { root, config };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mode(filePath: string) {
  return (await lstat(filePath)).mode & 0o777;
}

class FakeTransport implements AppServerTransport {
  connected = false;
  connectCalls = 0;
  closeCalls = 0;

  async connect() {
    this.connectCalls += 1;
    this.connected = true;
  }

  async send(_message: AppServerRequest) {}

  async *events(): AsyncIterable<AppServerEvent> {}

  async health(): Promise<TransportHealth> {
    return {
      healthy: this.connected,
      state: this.connected ? "connected" : "closed",
      endpoint: "ws://127.0.0.1:4500/worker",
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

  async close() {
    this.closeCalls += 1;
    this.connected = false;
  }
}

class FakeRuntime implements ManagedWorkerRuntime {
  readonly transport = new FakeTransport();
  started = false;
  stopCalls = 0;

  constructor(private readonly onStart: () => Promise<void>) {}

  async start() {
    await this.onStart();
    this.started = true;
  }

  async health() {
    return {
      healthy: this.started,
      state: this.started ? "running" as const : "stopped" as const,
    };
  }

  async stop() {
    this.stopCalls += 1;
    this.started = false;
  }
}

class RecordingFactory implements WorkerRuntimeFactory {
  readonly contexts: WorkerLaunchContext[] = [];
  readonly runtimes: FakeRuntime[] = [];
  activeStarts = 0;
  maxActiveStarts = 0;

  constructor(
    private readonly startDelayMs = 0,
    private readonly onActive?: (activeStarts: number) => Promise<void>,
  ) {}

  create(context: WorkerLaunchContext) {
    this.contexts.push(context);
    const runtime = new FakeRuntime(async () => {
      this.activeStarts += 1;
      this.maxActiveStarts = Math.max(this.maxActiveStarts, this.activeStarts);
      try {
        await this.onActive?.(this.activeStarts);
        if (this.startDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.startDelayMs));
        }
      } finally {
        this.activeStarts -= 1;
      }
    });
    this.runtimes.push(runtime);
    return runtime;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("WorkerProvisioner", () => {
  it("idempotently provisions twenty isolated users with restrictive permissions", async () => {
    const { config } = await fixture();
    const provisioner = new WorkerProvisioner({
      config,
      now: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    const users = Array.from({ length: 20 }, (_, index) => syntheticUser(index + 1));
    const manifests = await Promise.all(users.map((userId) => provisioner.provision(userId)));

    expect(new Set(manifests.map(({ roots }) => roots.userRoot))).toHaveLength(20);
    expect(new Set(manifests.map(({ roots }) => roots.codexHome))).toHaveLength(20);
    expect(new Set(manifests.map(({ roots }) => roots.browserProfile))).toHaveLength(20);
    for (const manifest of manifests) {
      expect(manifest.roots.codexHome).not.toBe(manifest.roots.home);
      expect(JSON.stringify(manifest.roots)).not.toContain(config.paths.publishWriteRoot);
      for (const [key, workerPath] of Object.entries(manifest.roots)) {
        expect(await mode(workerPath), key).toBe(key === "manifest" ? 0o600 : 0o700);
      }
    }

    const concurrent = await Promise.all(Array.from({ length: 4 }, () => provisioner.provision(users[0])));
    expect(new Set(concurrent.map(({ provisionedAt }) => provisionedAt))).toEqual(
      new Set(["2026-08-27T08:00:00.000Z"]),
    );
    const afterRestart = await new WorkerProvisioner({
      config,
      now: () => Date.parse("2027-01-01T00:00:00.000Z"),
    }).provision(users[0]);
    expect(afterRestart).toEqual(manifests[0]);
  });

  it("rejects invalid identifiers, traversal, path overlap, and symlink substitution", async () => {
    const { root, config } = await fixture();
    const provisioner = new WorkerProvisioner({ config });
    await expect(provisioner.provision("../another-user")).rejects.toMatchObject({
      code: "WORKER_USER_ID_INVALID",
    });
    await expect(provisioner.provision("0000000A-0000-4000-8000-000000000001")).rejects.toMatchObject({
      code: "WORKER_USER_ID_INVALID",
    });

    const overlapping = {
      ...config,
      paths: { ...config.paths, publishWriteRoot: config.paths.usersRoot },
    } satisfies InstallationConfig;
    expect(() => deriveWorkerRoots(overlapping, syntheticUser(1))).toThrowError(
      expect.objectContaining({ code: "WORKER_PUBLISH_PATH_OVERLAP" }),
    );

    await mkdir(config.paths.usersRoot, { recursive: true });
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(config.paths.usersRoot, syntheticUser(2)));
    await expect(provisioner.provision(syntheticUser(2))).rejects.toMatchObject({
      code: "WORKER_SYMLINK_REJECTED",
    });
    expect(await readFile(path.join(outside, "worker.json"), "utf8").catch(() => null)).toBeNull();
  });

  it("securely distributes one QA Codex subscription without sharing worker roots", async () => {
    const { config } = await fixture();
    const sharedRoot = path.join(config.paths.dataRoot, "shared-codex-auth");
    const sourcePath = path.join(sharedRoot, "auth.json");
    await mkdir(sharedRoot, { recursive: true, mode: 0o700 });
    await writeFile(sourcePath, JSON.stringify({ auth_mode: "chatgpt", tokens: { test: "secret-a" } }), {
      mode: 0o600,
    });
    const provisioner = new WorkerProvisioner({
      config,
      now: () => Date.parse("2026-08-27T16:30:00.000Z"),
      sharedCodexAuth: { scope: "shared-qa", sourcePath },
    });

    const [first, second] = await Promise.all([
      provisioner.provision(syntheticUser(1)),
      provisioner.provision(syntheticUser(2)),
    ]);
    expect(first.roots.codexHome).not.toBe(second.roots.codexHome);
    for (const manifest of [first, second]) {
      const authPath = path.join(manifest.roots.codexHome, "auth.json");
      expect(await readFile(authPath, "utf8")).toContain("secret-a");
      expect(await mode(authPath)).toBe(0o600);
      const receipt = await readFile(path.join(manifest.roots.auditRoot, "codex-auth-scope.json"), "utf8");
      expect(receipt).toContain('"scope": "shared-qa"');
      expect(receipt).not.toContain("secret-a");
    }

    await writeFile(sourcePath, JSON.stringify({ auth_mode: "chatgpt", tokens: { test: "secret-b" } }), {
      mode: 0o600,
    });
    await provisioner.provision(first.userId);
    expect(await readFile(path.join(first.roots.codexHome, "auth.json"), "utf8")).toContain("secret-b");
  });

  it("rejects unsafe shared Codex credential sources", async () => {
    const { root, config } = await fixture();
    const outside = path.join(root, "outside-auth.json");
    const linkedRoot = path.join(config.paths.dataRoot, "linked");
    const linked = path.join(linkedRoot, "auth.json");
    await mkdir(config.paths.dataRoot, { recursive: true, mode: 0o700 });
    await mkdir(linkedRoot, { mode: 0o700 });
    await writeFile(outside, "{}", { mode: 0o600 });
    await symlink(outside, linked);

    await expect(new WorkerProvisioner({
      config,
      sharedCodexAuth: { scope: "shared-qa", sourcePath: linked },
    }).provision(syntheticUser(3))).rejects.toMatchObject({
      code: "WORKER_SHARED_AUTH_SOURCE_UNSAFE",
    });

    const insecure = path.join(config.paths.dataRoot, "auth.json");
    await writeFile(insecure, "{}", { mode: 0o644 });
    await expect(new WorkerProvisioner({
      config,
      sharedCodexAuth: { scope: "shared-qa", sourcePath: insecure },
    }).provision(syntheticUser(4))).rejects.toMatchObject({
      code: "WORKER_SHARED_AUTH_SOURCE_UNSAFE",
    });
  });

  it("resolves only normalized paths without existing symlink components", async () => {
    const { root } = await fixture();
    const owned = path.join(root, "owned");
    const outside = path.join(root, "outside");
    await Promise.all([mkdir(path.join(owned, "safe"), { recursive: true }), mkdir(outside)]);
    await chmod(owned, 0o700);

    await expect(resolveWorkerOwnedPath(owned, "safe/file.txt")).resolves.toBe(
      path.join(owned, "safe", "file.txt"),
    );
    for (const unsafe of ["../outside", "safe/../outside", "./safe", "safe\\file", "safe//file"] as const) {
      await expect(resolveWorkerOwnedPath(owned, unsafe), unsafe).rejects.toBeInstanceOf(
        WorkerProvisioningError,
      );
    }
    await symlink(outside, path.join(owned, "linked"));
    await expect(resolveWorkerOwnedPath(owned, "linked/file.txt")).rejects.toMatchObject({
      code: "WORKER_SYMLINK_REJECTED",
    });
  });
});

describe("WorkerRuntimeRegistry", () => {
  it("drains admitted work and rejects new worker starts during maintenance", async () => {
    const { config } = await fixture();
    const maintenance = new MaintenanceCoordinator();
    const factory = new RecordingFactory();
    const registry = new WorkerRuntimeRegistry({ config, factory, maintenance });
    const turnLease = maintenance.acquire("turn");
    const draining = maintenance.enter({ timeoutMs: 1_000 });

    const admitted = await registry.start(syntheticUser(1), turnLease);
    expect(admitted.userId).toBe(syntheticUser(1));
    await expect(registry.start(syntheticUser(2))).rejects.toMatchObject({
      code: "MAINTENANCE_ACTIVE",
      phase: "draining",
    });
    expect(maintenance.status()).toMatchObject({ phase: "draining", activeActivities: 1 });

    turnLease.release();
    await expect(draining).resolves.toMatchObject({ phase: "maintenance", activeActivities: 0 });
    await expect(registry.start(syntheticUser(2))).rejects.toMatchObject({
      code: "MAINTENANCE_ACTIVE",
      phase: "maintenance",
    });

    maintenance.resume();
    await expect(registry.start(syntheticUser(2))).resolves.toMatchObject({ userId: syntheticUser(2) });
    await registry.close();
  });

  it("counts an in-flight worker start as drainable activity", async () => {
    const { config } = await fixture();
    const entered = deferred();
    const release = deferred();
    const maintenance = new MaintenanceCoordinator();
    const factory = new RecordingFactory(0, async () => {
      entered.resolve();
      await release.promise;
    });
    const registry = new WorkerRuntimeRegistry({ config, factory, maintenance });
    const starting = registry.start(syntheticUser(1));
    await entered.promise;
    const draining = maintenance.enter({ timeoutMs: 1_000 });

    expect(maintenance.status()).toMatchObject({
      phase: "draining",
      activeActivities: 1,
      activeByKind: { turn: 0, "worker-start": 1 },
    });
    release.resolve();
    await starting;
    await expect(draining).resolves.toMatchObject({ phase: "maintenance", activeActivities: 0 });
    await registry.close();
  });

  it("starts twenty users with bounded concurrency and keeps lifecycle isolated", async () => {
    const { config } = await fixture();
    const threeStartsEntered = deferred();
    const releaseStarts = deferred();
    const factory = new RecordingFactory(0, async (activeStarts) => {
      if (activeStarts === 3) threeStartsEntered.resolve();
      await releaseStarts.promise;
    });
    const registry = new WorkerRuntimeRegistry({
      config,
      factory,
      maxConcurrentStarts: 3,
      maxPendingStarts: 20,
    });
    const users = Array.from({ length: 20 }, (_, index) => syntheticUser(index + 1));
    const pendingHandles = Promise.all(users.map((userId) => registry.start(userId)));
    await threeStartsEntered.promise;

    expect(factory.maxActiveStarts).toBe(3);
    releaseStarts.resolve();
    const handles = await pendingHandles;
    expect(factory.contexts).toHaveLength(20);
    expect(new Set(handles.map(({ transport }) => transport))).toHaveLength(20);
    expect(new Set(handles.map(({ roots }) => roots.workspace))).toHaveLength(20);
    for (const context of factory.contexts) {
      expect(JSON.stringify(context)).not.toContain(config.paths.publishWriteRoot);
      expect(context.environment.HOME).not.toBe(context.environment.CODEX_HOME);
      expect(context.mounts.runtimeReadWrite).toContain(context.environment.TMPDIR);
      expect(context.mounts.runtimeReadWrite).not.toContain(context.staging);
      expect(context.mounts.runtimeReadWrite).not.toContain(context.browser.profile);
      expect(context.mounts.browserReadWrite).not.toContain(context.workspace);
    }

    const firstAgain = await registry.start(users[0]);
    expect(firstAgain).toBe(handles[0]);
    expect(factory.contexts).toHaveLength(20);
    expect(await registry.stop(users[0])).toBe(true);
    expect(registry.get(users[0])).toBeNull();
    expect(registry.get(users[1])).toBe(handles[1]);
    expect((await registry.health(users[1])).healthy).toBe(true);
    const firstRuntimeIndex = factory.contexts.findIndex(({ userId }) => userId === users[0]);
    const secondRuntimeIndex = factory.contexts.findIndex(({ userId }) => userId === users[1]);
    expect(factory.runtimes[firstRuntimeIndex].stopCalls).toBe(1);
    expect(factory.runtimes[secondRuntimeIndex].stopCalls).toBe(0);

    const restarted = await registry.start(users[0]);
    expect(restarted.roots).toEqual(handles[0].roots);
    expect(restarted.transport).not.toBe(handles[0].transport);
    await registry.close();
    expect(users.every((userId) => registry.get(userId) === null)).toBe(true);
  });

  it("fails fast with retry metadata when start capacity is saturated", async () => {
    const { config } = await fixture();
    const entered = deferred();
    const release = deferred();
    const factory: WorkerRuntimeFactory = {
      create() {
        return new FakeRuntime(async () => {
          entered.resolve();
          await release.promise;
        });
      },
    };
    const registry = new WorkerRuntimeRegistry({
      config,
      factory,
      maxConcurrentStarts: 1,
      maxPendingStarts: 0,
      backpressureRetryAfterMs: 2_500,
    });
    const first = registry.start(syntheticUser(1));
    await entered.promise;
    await expect(registry.start(syntheticUser(2))).rejects.toMatchObject({
      code: "WORKER_START_BACKPRESSURE",
      retryable: true,
      retryAfterMs: 2_500,
    } satisfies Partial<WorkerRegistryBackpressureError>);
    release.resolve();
    await first;
    await registry.close();
  });

  it("stops a worker when its transport never connects", async () => {
    const { config } = await fixture();
    const runtime = new FakeRuntime(async () => undefined);
    runtime.transport.connect = async () => new Promise<never>(() => undefined);
    const registry = new WorkerRuntimeRegistry({
      config,
      factory: { create: () => runtime },
      workerConnectTimeoutMs: 10,
    });

    await expect(registry.start(syntheticUser(1))).rejects.toThrow(
      "Worker transport did not connect in time.",
    );
    expect(runtime.transport.closeCalls).toBe(1);
    expect(runtime.stopCalls).toBe(1);
    await expect(registry.health(syntheticUser(1))).resolves.toMatchObject({
      state: "failed",
      healthy: false,
    });
    await registry.close();
  });

  it("recovers durable roots in a new registry and rejects factory object reuse", async () => {
    const { config } = await fixture();
    const firstFactory = new RecordingFactory();
    const firstRegistry = new WorkerRuntimeRegistry({ config, factory: firstFactory });
    const first = await firstRegistry.start(syntheticUser(1));
    await firstRegistry.close();

    const secondFactory = new RecordingFactory();
    const secondRegistry = new WorkerRuntimeRegistry({ config, factory: secondFactory });
    const recovered = await secondRegistry.start(syntheticUser(1));
    expect(recovered.roots).toEqual(first.roots);
    expect(recovered.transport).not.toBe(first.transport);
    await secondRegistry.close();

    const shared = new FakeRuntime(async () => undefined);
    const unsafeFactory: WorkerRuntimeFactory = { create: () => shared };
    const unsafeRegistry = new WorkerRuntimeRegistry({ config, factory: unsafeFactory });
    await unsafeRegistry.start(syntheticUser(2));
    await unsafeRegistry.stop(syntheticUser(2));
    await expect(unsafeRegistry.start(syntheticUser(3))).rejects.toThrow(
      "Worker factory reused a runtime or transport instance.",
    );
    await unsafeRegistry.close();
  });

  it("builds a launch context without exposing publisher write access", async () => {
    const { config } = await fixture();
    const manifest = await new WorkerProvisioner({ config }).provision(syntheticUser(1));
    const context = buildWorkerLaunchContext(config, manifest);
    expect(context.mounts.runtimeReadOnly).toEqual([
      config.paths.companyContextRoot,
      config.paths.sourceReadRoot,
    ]);
    expect(context.mounts.runtimeReadWrite).not.toContain(config.paths.publishWriteRoot);
    expect(context.mounts.runtimeReadWrite).toContain(manifest.roots.stagingTemp);
    expect(context.mounts.runtimeReadWrite).not.toContain(manifest.roots.staging);
    expect(context.mounts.browserReadWrite).not.toContain(config.paths.publishWriteRoot);
    expect(Object.values(context.environment)).not.toContain(config.paths.publishWriteRoot);
  });
});
