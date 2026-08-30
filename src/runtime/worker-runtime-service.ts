import { createHash, randomUUID } from "node:crypto";
import type { ClientRequest } from "../../contracts/codex/0.149.1/types/ClientRequest";
import type { InstallationConfig } from "@/config/installation-schema";
import { FileLocalUserStore } from "@/auth/local-user-store";
import { loadInstallationConfig } from "@/config/installation";
import {
  MaintenanceCoordinator,
  type EnterMaintenanceOptions,
  type MaintenanceActivityLease,
} from "@/operations/maintenance";
import {
  parseAccount,
  parseModels,
  parseRateLimit,
  parseSkills,
  parseUsage,
  type CodexConnection,
  type ResolvedSkill,
} from "@/runtime/codex-app-server";
import { AppServerRpcRouter } from "@/runtime/transport/app-server-rpc-router";
import type { AppServerEvent, JsonValue } from "@/runtime/transport";
import { LocalGatewayWorkerRuntimeFactory } from "@/runtime/workers/local-gateway-runtime";
import { WorkerRuntimeRegistry } from "@/runtime/workers/registry";
import type { WorkerRuntimeHandle } from "@/runtime/workers/types";

const CATALOG_FRESH_TTL_MS = 5 * 60_000;
const CATALOG_STALE_TTL_MS = 30 * 60_000;
const PENDING_TURN_CANCELLATION_TTL_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function installationFingerprint(config: Readonly<InstallationConfig>) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: config.schemaVersion,
    installationId: config.installationId,
    usersRoot: config.paths.usersRoot,
    companyContextRoot: config.paths.companyContextRoot,
    sourceReadRoot: config.paths.sourceReadRoot,
    publishWriteRoot: config.paths.publishWriteRoot,
  })).digest("hex");
}

function randomRequest(
  method: ClientRequest["method"],
  params: unknown,
  purpose: string,
) {
  return {
    method,
    id: `${purpose}:${randomUUID()}`,
    params,
  } as ClientRequest;
}

function isAlreadyInitialized(error: unknown) {
  return error instanceof Error
    && error.message === "Already initialized"
    && "code" in error
    && error.code === -32600;
}

export class WorkerAppServerClient {
  readonly router: AppServerRpcRouter;
  private initialized: Promise<void> | null = null;
  private readonly loadedThreads = new Map<string, boolean>();
  private account: CodexConnection | null = null;
  private cachedConnection: CodexConnection | null = null;
  private cachedConnectionCwd: string | null = null;
  private cachedAt = 0;
  private catalogRefresh: Promise<CodexConnection> | null = null;
  private catalogRefreshCwd: string | null = null;

  constructor(
    readonly handle: WorkerRuntimeHandle,
    private readonly maintenance: MaintenanceCoordinator | null = null,
  ) {
    this.router = new AppServerRpcRouter(handle.transport);
  }

  async initialize() {
    if (this.router.failed) throw new Error("App Server transport is unavailable.");
    if (!this.initialized) {
      this.initialized = this.initializeOnce().catch((error) => {
        this.initialized = null;
        throw error;
      });
    }
    await this.initialized;
    if (this.router.failed) throw new Error("App Server transport is unavailable.");
  }

  private async initializeOnce() {
    await this.router.start();
    let initializedHere = true;
    try {
      await this.router.request(randomRequest("initialize", {
        clientInfo: {
          name: "aibrain_workbench",
          title: "Asistente",
          version: "0.4.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      }, "initialize"), 30_000);
    } catch (error) {
      if (!isAlreadyInitialized(error)) throw error;
      initializedHere = false;
    }
    if (initializedHere) {
      await this.router.notify({ method: "initialized" }, `initialized:${randomUUID()}`);
    }
    this.account = parseAccount(await this.router.request(randomRequest(
      "account/read",
      { refreshToken: false },
      "account-read",
    ), 10_000));
  }

  async request(
    method: ClientRequest["method"],
    params: unknown,
    purpose: string,
    timeoutMs = 30_000,
    beforeResolve?: (value: JsonValue, event: AppServerEvent) => void | Promise<void>,
    activityLease?: MaintenanceActivityLease,
  ) {
    if (method === "turn/start") this.maintenance?.assertActiveLease(activityLease);
    await this.initialize();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(purpose)) {
      throw new Error("Stable App Server request id is invalid.");
    }
    const result = await this.router.request(
      { method, id: purpose, params } as ClientRequest,
      timeoutMs,
      beforeResolve,
    );
    if ((method === "thread/start" || method === "thread/resume") &&
        isRecord(result) && isRecord(result.thread) && typeof result.thread.id === "string" &&
        isRecord(params) && isRecord(params.config)) {
      this.loadedThreads.set(result.thread.id, params.config.web_search === "live");
    }
    return result;
  }

  /**
   * A loaded thread can accept `turn/start` directly. The cache belongs to
   * this client/transport, so replacing or restarting App Server naturally
   * makes every persisted thread require one fresh `thread/resume`.
   */
  canReuseLoadedThread(threadId: string, webSearchEnabled: boolean) {
    return this.loadedThreads.get(threadId) === webSearchEnabled;
  }

  async connection(cwd: string, forceRefresh = false): Promise<CodexConnection> {
    await this.initialize();
    if (!this.account) throw new Error("Codex did not return account state.");
    const cachedForCwd = this.cachedConnection && this.cachedConnectionCwd === cwd
      ? this.cachedConnection
      : null;
    const cacheAge = Date.now() - this.cachedAt;
    if (!forceRefresh && cachedForCwd && cacheAge < CATALOG_FRESH_TTL_MS) {
      return cachedForCwd;
    }
    if (!forceRefresh && cachedForCwd && cacheAge < CATALOG_STALE_TTL_MS) {
      void this.refreshConnection(cwd).catch(() => undefined);
      return cachedForCwd;
    }
    return this.refreshConnection(cwd);
  }

  /**
   * Starts loading the optional catalog without delaying the caller. Runtime
   * status uses this after the worker account has been verified so the first
   * real turn normally finds a warm model and skill catalog.
   */
  prewarmConnection(cwd: string) {
    void this.connection(cwd).catch(() => undefined);
  }

  private refreshConnection(cwd: string): Promise<CodexConnection> {
    if (this.catalogRefresh) {
      if (this.catalogRefreshCwd === cwd) return this.catalogRefresh;
      return this.catalogRefresh.then(() => this.refreshConnection(cwd));
    }
    this.catalogRefreshCwd = cwd;
    this.catalogRefresh = this.loadConnection(cwd).finally(() => {
      this.catalogRefresh = null;
      this.catalogRefreshCwd = null;
    });
    return this.catalogRefresh;
  }

  private async loadConnection(cwd: string): Promise<CodexConnection> {
    if (!this.account) throw new Error("Codex did not return account state.");
    const [modelsResult, skillsResult, capabilitiesResult, rateLimitResult, usageResult] = await Promise.all([
      this.router.request(randomRequest("model/list", { limit: 30, includeHidden: false }, "models"), 10_000).catch(() => null),
      this.router.request(randomRequest("skills/list", { cwds: [cwd], forceReload: false }, "skills"), 10_000).catch(() => null),
      this.router.request(randomRequest("modelProvider/capabilities/read", {}, "capabilities"), 10_000).catch(() => null),
      this.router.request(randomRequest("account/rateLimits/read", undefined, "rate-limits"), 10_000).catch(() => null),
      this.router.request(randomRequest("account/usage/read", undefined, "usage"), 10_000).catch(() => null),
    ]);
    this.cachedConnection = {
      ...this.account,
      processWarm: true,
      models: parseModels(modelsResult),
      skills: parseSkills(skillsResult).map(({ path: _path, ...skill }) => skill),
      webSearch: isRecord(capabilitiesResult) && capabilitiesResult.webSearch === true,
      imageGeneration: isRecord(capabilitiesResult) && capabilitiesResult.imageGeneration === true,
      rateLimit: parseRateLimit(rateLimitResult),
      usage: parseUsage(usageResult),
    };
    this.cachedConnectionCwd = cwd;
    this.cachedAt = Date.now();
    return this.cachedConnection;
  }

  /**
   * Returns the verified account state without waiting for the optional model,
   * skill, usage, and capability catalog. This keeps the readiness endpoint
   * bounded during a cold worker start; those details are loaded on demand by
   * `connection()` when a turn needs them.
   */
  async connectionSummary(): Promise<CodexConnection> {
    await this.initialize();
    if (!this.account) throw new Error("Codex did not return account state.");
    return {
      ...this.account,
      processWarm: true,
    };
  }

  /**
   * Reads only the capability flags that control whether the composer can
   * offer a live tool.  Keeping this separate from `connection()` lets the
   * readiness route report the actual web-search availability without waiting
   * for the optional model, skill, rate-limit, and usage catalogs.
   */
  async capabilities(): Promise<Pick<CodexConnection, "webSearch" | "imageGeneration">> {
    await this.initialize();
    const result = await this.router.request(randomRequest(
      "modelProvider/capabilities/read",
      {},
      "capabilities",
    ), 10_000).catch(() => null);
    return {
      webSearch: isRecord(result) && result.webSearch === true,
      imageGeneration: isRecord(result) && result.imageGeneration === true,
    };
  }

  async resolvedSkills(cwd: string): Promise<ResolvedSkill[]> {
    await this.initialize();
    return parseSkills(await this.router.request(randomRequest(
      "skills/list",
      { cwds: [cwd], forceReload: false },
      "resolved-skills",
    ), 10_000));
  }

  close() {
    return this.router.close();
  }
}

type RuntimeServiceState = {
  fingerprint: string;
  config: Readonly<InstallationConfig>;
  registry: WorkerRuntimeRegistry;
  maintenance: MaintenanceCoordinator;
  clients: Map<string, WorkerAppServerClient>;
  activeTurnCancellations: Map<string, {
    runtimeThreadId: string;
    cancelAfterRemoteInterrupt(remoteInterruptConfirmed: boolean): void;
  }>;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __aibrainWorkerRuntimeService?: RuntimeServiceState;
  __aibrainWorkerRuntimeServicePromise?: Promise<RuntimeServiceState>;
  __aibrainPendingWorkerTurnCancellations?: Map<string, number>;
};

function pendingTurnCancellations() {
  const pending = runtimeGlobal.__aibrainPendingWorkerTurnCancellations ??= new Map<string, number>();
  const expiredBefore = Date.now() - PENDING_TURN_CANCELLATION_TTL_MS;
  for (const [key, requestedAt] of pending) {
    if (requestedAt < expiredBefore) pending.delete(key);
  }
  return pending;
}

async function serviceState(): Promise<RuntimeServiceState> {
  const config = await loadInstallationConfig();
  const fingerprint = installationFingerprint(config);
  const existing = runtimeGlobal.__aibrainWorkerRuntimeService;
  if (existing?.fingerprint === fingerprint) return existing;
  const inFlight = runtimeGlobal.__aibrainWorkerRuntimeServicePromise;
  if (inFlight) {
    const initialized = await inFlight;
    return initialized.fingerprint === fingerprint ? initialized : serviceState();
  }
  const initialize = (async () => {
    const replaced = runtimeGlobal.__aibrainWorkerRuntimeService;
    if (replaced) {
      await Promise.allSettled([
        ...[...replaced.clients.values()].map((client) => client.close()),
        replaced.registry.close(),
      ]);
    }
    const maintenance = new MaintenanceCoordinator();
    const state: RuntimeServiceState = {
      fingerprint,
      config,
      registry: new WorkerRuntimeRegistry({
        config,
        factory: new LocalGatewayWorkerRuntimeFactory(),
        maintenance,
      }),
      maintenance,
      clients: new Map(),
      activeTurnCancellations: new Map(),
    };
    runtimeGlobal.__aibrainWorkerRuntimeService = state;
    return state;
  })();
  runtimeGlobal.__aibrainWorkerRuntimeServicePromise = initialize;
  try {
    return await initialize;
  } finally {
    if (runtimeGlobal.__aibrainWorkerRuntimeServicePromise === initialize) {
      delete runtimeGlobal.__aibrainWorkerRuntimeServicePromise;
    }
  }
}

export async function workerAppServerForUser(
  userId: string,
  activityLease?: MaintenanceActivityLease,
) {
  const state = await serviceState();
  const localUser = await new FileLocalUserStore(state.config.paths.usersRoot).read(userId);
  if (!localUser?.enabled) {
    throw new Error("Worker user is not provisioned or is disabled.");
  }
  if (activityLease) state.maintenance.assertActiveLease(activityLease);
  // This is sampled before `start()`: it distinguishes an already-running
  // employee process from a cold start without exposing a worker identifier.
  const workerWasWarm = state.registry.get(userId) !== null;
  let handle: WorkerRuntimeHandle;
  try {
    handle = await state.registry.start(userId, activityLease);
  } catch {
    // A failed gateway connection has already been stopped by the registry.
    // One clean retry recovers transient process and socket startup races.
    handle = await state.registry.start(userId, activityLease);
  }
  let client = state.clients.get(userId);
  if (!client || client.handle.transport !== handle.transport) {
    if (client) await client.close();
    client = new WorkerAppServerClient(handle, state.maintenance);
    state.clients.set(userId, client);
  }
  try {
    await client.initialize();
  } catch {
    await client.close().catch(() => undefined);
    state.clients.delete(userId);
    await state.registry.stop(userId).catch(() => undefined);
    handle = await state.registry.start(userId, activityLease);
    client = new WorkerAppServerClient(handle, state.maintenance);
    state.clients.set(userId, client);
    try {
      await client.initialize();
    } catch (retryError) {
      state.clients.delete(userId);
      throw retryError;
    }
  }
  return { config: state.config, registry: state.registry, handle, client, workerWasWarm };
}

export async function acquireWorkerTurnActivity() {
  const state = await serviceState();
  return state.maintenance.acquire("turn");
}

export async function workerMaintenanceStatus() {
  return (await serviceState()).maintenance.status();
}

export async function enterWorkerMaintenance(options: EnterMaintenanceOptions) {
  return (await serviceState()).maintenance.enter(options);
}

export async function resumeWorkerMaintenance() {
  return (await serviceState()).maintenance.resume();
}

export async function workerRuntimeHealth(userId: string) {
  const state = await serviceState();
  return state.registry.health(userId);
}

/** Stops only the selected employee runtime and releases its active stream handlers. */
export async function stopWorkerRuntimeForUser(userId: string) {
  const state = runtimeGlobal.__aibrainWorkerRuntimeService;
  if (!state) return false;
  const client = state.clients.get(userId);
  if (client) {
    await client.close().catch(() => undefined);
    state.clients.delete(userId);
  }
  for (const [key, registration] of state.activeTurnCancellations) {
    if (!key.startsWith(`${userId}:`)) continue;
    registration.cancelAfterRemoteInterrupt(true);
    state.activeTurnCancellations.delete(key);
  }
  for (const key of pendingTurnCancellations().keys()) {
    if (key.startsWith(`${userId}:`)) pendingTurnCancellations().delete(key);
  }
  return state.registry.stop(userId);
}

export function workerTurnIsActive(
  userId: string,
  runtimeThreadId: string,
  localTurnId: string,
) {
  const state = runtimeGlobal.__aibrainWorkerRuntimeService;
  const client = state?.clients.get(userId);
  return client?.router.hasActiveTurn(runtimeThreadId, localTurnId) ?? false;
}

function activeTurnKey(userId: string, localTurnId: string) {
  return `${userId}:${localTurnId}`;
}

export function registerWorkerTurnCancellation(
  userId: string,
  runtimeThreadId: string,
  localTurnId: string,
  cancelAfterRemoteInterrupt: (remoteInterruptConfirmed: boolean) => void,
) {
  const state = runtimeGlobal.__aibrainWorkerRuntimeService;
  if (!state || !state.clients.has(userId) || !runtimeThreadId || !localTurnId) {
    throw new Error("Worker turn cancellation scope is unavailable.");
  }
  const key = activeTurnKey(userId, localTurnId);
  if (state.activeTurnCancellations.has(key)) {
    throw new Error("Worker turn cancellation scope is already registered.");
  }
  const registration = { runtimeThreadId, cancelAfterRemoteInterrupt };
  state.activeTurnCancellations.set(key, registration);
  if (pendingTurnCancellations().delete(key)) {
    cancelAfterRemoteInterrupt(false);
  }
  return () => {
    if (state.activeTurnCancellations.get(key) === registration) {
      state.activeTurnCancellations.delete(key);
    }
  };
}

export function cancelWorkerTurnLocally(
  userId: string,
  runtimeThreadId: string,
  localTurnId: string,
  remoteInterruptConfirmed = true,
) {
  const state = runtimeGlobal.__aibrainWorkerRuntimeService;
  const registration = state?.activeTurnCancellations.get(activeTurnKey(userId, localTurnId));
  if (!registration || registration.runtimeThreadId !== runtimeThreadId) return false;
  registration.cancelAfterRemoteInterrupt(remoteInterruptConfirmed);
  return true;
}

export function requestPendingWorkerTurnCancellation(
  userId: string,
  localTurnId: string,
) {
  const state = runtimeGlobal.__aibrainWorkerRuntimeService;
  if (!localTurnId) return false;
  const key = activeTurnKey(userId, localTurnId);
  const registration = state?.activeTurnCancellations.get(key);
  if (registration) {
    registration.cancelAfterRemoteInterrupt(false);
    return true;
  }
  pendingTurnCancellations().set(key, Date.now());
  return true;
}
