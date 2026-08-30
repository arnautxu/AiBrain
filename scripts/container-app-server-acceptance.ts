import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppServerRpcRouter } from "@/runtime/transport";
import { LocalGatewayWorkerRuntimeFactory } from "@/runtime/workers/local-gateway-runtime";
import type { ManagedWorkerRuntime, WorkerLaunchContext } from "@/runtime/workers/types";

const ACCEPTANCE_TIMEOUT_MS = 20_000;
const EXPECTED_CODEX_VERSION = "0.149.1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withDeadline<T>(operation: Promise<T>, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${ACCEPTANCE_TIMEOUT_MS}ms.`)),
      ACCEPTANCE_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function installationUsersRoot() {
  const configPath = process.env.AIBRAIN_INSTALLATION_CONFIG?.trim()
    || "/etc/aibrain/installation.json";
  const config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (!isRecord(config) || !isRecord(config.paths) || typeof config.paths.usersRoot !== "string") {
    throw new Error("Installation usersRoot is unavailable for App Server acceptance.");
  }
  const usersRoot = path.resolve(config.paths.usersRoot);
  if (process.env.NODE_ENV === "production" && usersRoot !== "/var/lib/aibrain/data/users") {
    throw new Error("Production App Server acceptance requires the immutable users root.");
  }
  return usersRoot;
}

async function createContext(usersRoot: string) {
  const userId = randomUUID();
  const userRoot = path.join(usersRoot, userId);
  const runtimeRoot = path.join(userRoot, "runtime");
  const xdgRoot = path.join(runtimeRoot, "xdg");
  const staging = path.join(userRoot, "staging");
  const context: WorkerLaunchContext = Object.freeze({
    installationId: "container-app-server-acceptance",
    userId,
    workerId: `worker-${userId}`,
    environment: Object.freeze({
      HOME: path.join(runtimeRoot, "home"),
      CODEX_HOME: path.join(runtimeRoot, "codex-home"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
      TMPDIR: path.join(staging, "tmp"),
    }),
    mounts: Object.freeze({
      runtimeReadOnly: Object.freeze([]),
      runtimeReadWrite: Object.freeze([
        runtimeRoot,
        path.join(userRoot, "workspace"),
        staging,
        path.join(userRoot, "artifacts"),
        path.join(userRoot, "audit", "transport"),
      ]),
      browserReadWrite: Object.freeze([]),
    }),
    workspace: path.join(userRoot, "workspace"),
    staging,
    artifacts: path.join(userRoot, "artifacts"),
    transportAudit: path.join(userRoot, "audit", "transport"),
    browser: Object.freeze({
      profile: path.join(userRoot, "browser", "profile"),
      downloads: path.join(userRoot, "browser", "downloads"),
    }),
  });
  await Promise.all([
    ...Object.values(context.environment).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
    mkdir(context.workspace, { recursive: true, mode: 0o700 }),
    mkdir(path.join(context.staging, "threads"), { recursive: true, mode: 0o700 }),
    mkdir(context.artifacts, { recursive: true, mode: 0o700 }),
    mkdir(context.transportAudit, { recursive: true, mode: 0o700 }),
    mkdir(context.browser.profile, { recursive: true, mode: 0o700 }),
    mkdir(context.browser.downloads, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    writeFile(path.join(userRoot, "PROFILE.md"), "# Acceptance employee\n", { mode: 0o600 }),
    writeFile(path.join(userRoot, "PREFERENCES.md"), "# Acceptance preferences\n", { mode: 0o600 }),
    writeFile(path.join(userRoot, "PERMISSIONS.md"), "# Acceptance permissions\n", { mode: 0o600 }),
  ]);
  return { context, userRoot };
}

async function acceptOneGeneration(context: WorkerLaunchContext, generation: number) {
  const runtime = new LocalGatewayWorkerRuntimeFactory({
    runtimeInstanceId: "container-acceptance",
  }).create(context);
  const router = new AppServerRpcRouter(runtime.transport);
  try {
    await runtime.start();
    const initialize = await router.request({
      method: "initialize",
      id: `acceptance-initialize-${generation}-${randomUUID()}`,
      params: {
        clientInfo: {
          name: "aibrain_container_acceptance",
          title: "AiBrain Container Acceptance",
          version: "1.0.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    }, 10_000);
    if (!isRecord(initialize)) throw new Error("Codex initialize returned an invalid result.");
    await router.notify({ method: "initialized" }, `acceptance-initialized-${generation}-${randomUUID()}`);
    const account = await router.request({
      method: "account/read",
      id: `acceptance-account-read-${generation}-${randomUUID()}`,
      params: { refreshToken: false },
    }, 10_000);
    if (!isRecord(account) || !("account" in account)) {
      throw new Error("Codex account/read returned an invalid result.");
    }
    const health = await runtime.health();
    if (!health.healthy || health.state !== "running") {
      throw new Error("Private worker gateway was not healthy after App Server RPC acceptance.");
    }
  } finally {
    await Promise.allSettled([
      router.close(),
      runtime.transport.close(),
      stopRuntime(runtime),
    ]);
  }
}

async function stopRuntime(runtime: ManagedWorkerRuntime) {
  await runtime.stop();
}

export async function runContainerAppServerAcceptance() {
  if (process.env.AIBRAIN_CODEX_EXPECTED_VERSION?.trim() !== EXPECTED_CODEX_VERSION) {
    throw new Error(`App Server acceptance requires Codex ${EXPECTED_CODEX_VERSION}.`);
  }
  const usersRoot = await installationUsersRoot();
  const { context, userRoot } = await createContext(usersRoot);
  try {
    await acceptOneGeneration(context, 1);
    await acceptOneGeneration(context, 2);
  } finally {
    await rm(userRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  withDeadline(runContainerAppServerAcceptance(), "Codex App Server container acceptance").then(
    () => process.stdout.write("Codex App Server container acceptance passed.\n"),
    (error: unknown) => {
      process.stderr.write(`Codex App Server container acceptance failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 78;
    },
  );
}
