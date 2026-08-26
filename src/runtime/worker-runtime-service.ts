import { createHash, randomUUID } from "node:crypto";
import type { ClientRequest } from "../../contracts/codex/0.149.1/types/ClientRequest";
import type { InstallationConfig } from "@/config/installation-schema";
import { loadInstallationConfig } from "@/config/installation";
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
import { LocalGatewayWorkerRuntimeFactory } from "@/runtime/workers/local-gateway-runtime";
import { WorkerRuntimeRegistry } from "@/runtime/workers/registry";
import type { WorkerRuntimeHandle } from "@/runtime/workers/types";

const CATALOG_TTL_MS = 60_000;

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

function request(
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

export class WorkerAppServerClient {
  readonly router: AppServerRpcRouter;
  private initialized: Promise<void> | null = null;
  private account: CodexConnection | null = null;
  private cachedConnection: CodexConnection | null = null;
  private cachedAt = 0;

  constructor(readonly handle: WorkerRuntimeHandle) {
    this.router = new AppServerRpcRouter(handle.transport);
  }

  async initialize() {
    if (!this.initialized) {
      this.initialized = this.initializeOnce().catch((error) => {
        this.initialized = null;
        throw error;
      });
    }
    return this.initialized;
  }

  private async initializeOnce() {
    await this.router.start();
    await this.router.request(request("initialize", {
      clientInfo: {
        name: "aibrain_workbench",
        title: "AiBrain",
        version: "0.4.0",
      },
      capabilities: null,
    }, "initialize"), 30_000);
    await this.router.notify({ method: "initialized" }, `initialized:${randomUUID()}`);
    this.account = parseAccount(await this.router.request(request(
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
  ) {
    await this.initialize();
    return this.router.request(request(method, params, purpose), timeoutMs);
  }

  async connection(cwd: string, forceRefresh = false): Promise<CodexConnection> {
    await this.initialize();
    if (!this.account) throw new Error("Codex did not return account state.");
    if (!forceRefresh && this.cachedConnection && Date.now() - this.cachedAt < CATALOG_TTL_MS) {
      return this.cachedConnection;
    }
    const [modelsResult, skillsResult, capabilitiesResult, rateLimitResult, usageResult] = await Promise.all([
      this.router.request(request("model/list", { limit: 30, includeHidden: false }, "models"), 10_000).catch(() => null),
      this.router.request(request("skills/list", { cwds: [cwd], forceReload: false }, "skills"), 10_000).catch(() => null),
      this.router.request(request("modelProvider/capabilities/read", {}, "capabilities"), 10_000).catch(() => null),
      this.router.request(request("account/rateLimits/read", undefined, "rate-limits"), 10_000).catch(() => null),
      this.router.request(request("account/usage/read", undefined, "usage"), 10_000).catch(() => null),
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
    this.cachedAt = Date.now();
    return this.cachedConnection;
  }

  async resolvedSkills(cwd: string): Promise<ResolvedSkill[]> {
    await this.initialize();
    return parseSkills(await this.router.request(request(
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
  clients: Map<string, WorkerAppServerClient>;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __aibrainWorkerRuntimeService?: RuntimeServiceState;
  __aibrainWorkerRuntimeServicePromise?: Promise<RuntimeServiceState>;
};

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
    const state: RuntimeServiceState = {
      fingerprint,
      config,
      registry: new WorkerRuntimeRegistry({
        config,
        factory: new LocalGatewayWorkerRuntimeFactory(),
      }),
      clients: new Map(),
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

export async function workerAppServerForUser(userId: string) {
  const state = await serviceState();
  const handle = await state.registry.start(userId);
  let client = state.clients.get(userId);
  if (!client || client.handle.transport !== handle.transport) {
    if (client) await client.close();
    client = new WorkerAppServerClient(handle);
    state.clients.set(userId, client);
  }
  await client.initialize();
  return { config: state.config, registry: state.registry, handle, client };
}

export async function workerRuntimeHealth(userId: string) {
  const state = await serviceState();
  return state.registry.health(userId);
}
