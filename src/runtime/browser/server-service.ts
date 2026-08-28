import "server-only";

import { createHash } from "node:crypto";
import type { InstallationConfig } from "@/config/installation-schema";
import { loadInstallationConfig } from "@/config/installation";
import { getSigningSecret } from "@/auth/session";
import { FileLocalUserStore } from "@/auth/local-user-store";
import { BrowserGatewayTokenService } from "@/runtime/browser/gateway-token";
import { ChromeBrowserRuntimeFactory } from "@/runtime/browser/chrome-runtime";
import {
  BrowserRegistryBackpressureError,
  BrowserRuntimeRegistry,
} from "@/runtime/browser/registry";
import { BrowserSessionStore } from "@/runtime/browser/state-store";
import type {
  BrowserGatewayCapability,
  BrowserInputCommand,
} from "@/runtime/browser/types";
import { validateWorkerUserId } from "@/runtime/workers/provisioner";
import { featurePolicyForIdentity } from "@/settings/server-service";

export class BrowserServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "BrowserServiceError";
  }
}

type BrowserServiceState = {
  fingerprint: string;
  config: Readonly<InstallationConfig>;
  registry: BrowserRuntimeRegistry;
  tokens: BrowserGatewayTokenService;
};

const browserGlobal = globalThis as typeof globalThis & {
  __aibrainBrowserRuntimeService?: BrowserServiceState;
  __aibrainBrowserRuntimeServicePromise?: Promise<BrowserServiceState>;
};

function installationFingerprint(config: Readonly<InstallationConfig>) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: config.schemaVersion,
    installationId: config.installationId,
    usersRoot: config.paths.usersRoot,
  })).digest("hex");
}

function gatewaySecret() {
  const configured = process.env.AIBRAIN_BROWSER_GATEWAY_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new BrowserServiceError(
      "BROWSER_GATEWAY_SECRET_REQUIRED",
      "AIBRAIN_BROWSER_GATEWAY_SECRET is required in production.",
      503,
    );
  }
  return createHash("sha256").update(`browser-gateway:${getSigningSecret()}`).digest("hex");
}

async function serviceState(): Promise<BrowserServiceState> {
  const config = await loadInstallationConfig();
  const fingerprint = installationFingerprint(config);
  const existing = browserGlobal.__aibrainBrowserRuntimeService;
  if (existing?.fingerprint === fingerprint) return existing;
  const inFlight = browserGlobal.__aibrainBrowserRuntimeServicePromise;
  if (inFlight) {
    const initialized = await inFlight;
    return initialized.fingerprint === fingerprint ? initialized : serviceState();
  }
  const initialize = (async () => {
    const replaced = browserGlobal.__aibrainBrowserRuntimeService;
    if (replaced) await replaced.registry.close();
    const state: BrowserServiceState = {
      fingerprint,
      config,
      registry: new BrowserRuntimeRegistry({
        store: new BrowserSessionStore({ config }),
        factory: new ChromeBrowserRuntimeFactory({
          executablePath: process.env.AIBRAIN_CHROME_BIN?.trim() || undefined,
          expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION?.trim() || undefined,
        }),
        maxConcurrentStarts: Number(process.env.AIBRAIN_BROWSER_MAX_CONCURRENT_STARTS || 2),
        maxPendingStarts: Number(process.env.AIBRAIN_BROWSER_MAX_PENDING_STARTS || 20),
      }),
      tokens: new BrowserGatewayTokenService({ secret: gatewaySecret() }),
    };
    browserGlobal.__aibrainBrowserRuntimeService = state;
    return state;
  })();
  browserGlobal.__aibrainBrowserRuntimeServicePromise = initialize;
  try {
    return await initialize;
  } finally {
    if (browserGlobal.__aibrainBrowserRuntimeServicePromise === initialize) {
      delete browserGlobal.__aibrainBrowserRuntimeServicePromise;
    }
  }
}

function ensureBinding(state: BrowserServiceState, installationId: string, userId: string) {
  if (state.config.installationId !== installationId) {
    throw new BrowserServiceError(
      "BROWSER_INSTALLATION_MISMATCH",
      "Authenticated installation does not own this browser runtime.",
      403,
    );
  }
  try {
    validateWorkerUserId(userId);
  } catch {
    throw new BrowserServiceError("BROWSER_USER_INVALID", "Browser user is invalid.", 403);
  }
}

async function ensureEnabledUser(state: BrowserServiceState, userId: string) {
  const user = await new FileLocalUserStore(state.config.paths.usersRoot).read(userId);
  if (!user?.enabled) {
    throw new BrowserServiceError(
      "BROWSER_USER_DISABLED",
      "Browser user is not provisioned or is disabled.",
      403,
    );
  }
}

async function ensureBrowserEnabled(installationId: string, userId: string) {
  const policy = await featurePolicyForIdentity(installationId, userId);
  if (!policy["managed-browser"]) {
    throw new BrowserServiceError(
      "BROWSER_FEATURE_DISABLED",
      "The managed browser is disabled in Settings.",
      403,
    );
  }
}

async function currentHandle(state: BrowserServiceState, userId: string) {
  await state.registry.start(userId);
  const handle = state.registry.get(userId);
  const persistent = await state.registry.state(userId);
  if (!handle || !persistent.browserSessionId || handle.browserSessionId !== persistent.browserSessionId) {
    throw new BrowserServiceError(
      "BROWSER_RUNTIME_NOT_RUNNING",
      "Browser runtime is not running in this server process.",
      409,
      true,
    );
  }
  return { handle, persistent };
}

export async function browserStatus(installationId: string, userId: string) {
  const state = await serviceState();
  ensureBinding(state, installationId, userId);
  await ensureEnabledUser(state, userId);
  await ensureBrowserEnabled(installationId, userId);
  const health = await state.registry.health(userId);
  return {
    healthy: health.healthy,
    state: health.state,
    runtime: health.runtime,
    runningInProcess: state.registry.get(userId) !== null,
  };
}

export async function controlBrowser(
  installationId: string,
  userId: string,
  action: "start" | "stop" | "takeover" | "release" | "heartbeat",
) {
  const state = await serviceState();
  ensureBinding(state, installationId, userId);
  if (action !== "stop") await ensureBrowserEnabled(installationId, userId);
  if (action !== "stop") await ensureEnabledUser(state, userId);
  try {
    if (action === "start") await state.registry.start(userId);
    else if (action === "stop") {
      await state.registry.stop(userId);
      return {
        healthy: false,
        state: await state.registry.state(userId),
        runtime: null,
        runningInProcess: false,
      };
    } else if (action === "takeover") await state.registry.takeOver(userId);
    else if (action === "release") await state.registry.releaseTakeover(userId);
    else await state.registry.heartbeat(userId, "human");
    return browserStatus(installationId, userId);
  } catch (error) {
    if (error instanceof BrowserRegistryBackpressureError) {
      throw new BrowserServiceError(error.code, error.message, 429, true);
    }
    throw error;
  }
}

export async function issueBrowserGatewayToken(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  capabilities: readonly BrowserGatewayCapability[];
  ttlMs?: number;
}) {
  const state = await serviceState();
  ensureBinding(state, input.installationId, input.userId);
  await ensureBrowserEnabled(input.installationId, input.userId);
  await ensureEnabledUser(state, input.userId);
  const { handle, persistent } = await currentHandle(state, input.userId);
  if (persistent.lifecycle !== "ready" && persistent.lifecycle !== "human-control") {
    throw new BrowserServiceError("BROWSER_VIEWER_UNAVAILABLE", "Browser viewer is unavailable.", 409, true);
  }
  return {
    token: state.tokens.issue({
      installationId: input.installationId,
      userId: input.userId,
      threadId: input.threadId,
      browserSessionId: handle.browserSessionId,
      authSessionId: input.authSessionId,
      capabilities: input.capabilities,
      ttlMs: input.ttlMs,
    }),
    browserSessionId: handle.browserSessionId,
  };
}

async function authorizeGateway(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  capability: BrowserGatewayCapability;
}) {
  const state = await serviceState();
  ensureBinding(state, input.installationId, input.userId);
  await ensureBrowserEnabled(input.installationId, input.userId);
  await ensureEnabledUser(state, input.userId);
  const { handle } = await currentHandle(state, input.userId);
  state.tokens.verify(input.token, {
    installationId: input.installationId,
    userId: input.userId,
    threadId: input.threadId,
    browserSessionId: handle.browserSessionId,
    authSessionId: input.authSessionId,
    requiredCapability: input.capability,
  });
  return state;
}

export async function captureBrowserFrame(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
}) {
  const state = await authorizeGateway({ ...input, capability: "view" });
  return state.registry.captureFrame(input.userId, input.threadId);
}

export async function sendBrowserViewerCommand(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  command: { action: "navigate"; url: string } | { action: "input"; command: BrowserInputCommand };
}) {
  const state = await authorizeGateway({ ...input, capability: "control" });
  if (input.command.action === "navigate") {
    await state.registry.navigate(input.userId, input.threadId, input.command.url);
  } else {
    await state.registry.dispatchInput(input.userId, input.threadId, input.command.command);
  }
}

export type BrowserAgentCommand =
  | { action: "open"; url: string }
  | { action: "read" }
  | { action: "screenshot" }
  | { action: "scroll"; deltaX: number; deltaY: number }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string; clear: boolean }
  | { action: "tabs" }
  | { action: "downloads" };

/** Closed, typed browser surface for server-owned Codex dynamic tools. */
export async function executeBrowserAgentCommand(input: {
  installationId: string;
  userId: string;
  threadId: string;
  command: BrowserAgentCommand;
}) {
  const state = await serviceState();
  ensureBinding(state, input.installationId, input.userId);
  await ensureBrowserEnabled(input.installationId, input.userId);
  await ensureEnabledUser(state, input.userId);
  try {
    await state.registry.start(input.userId);
  } catch (error) {
    if (error instanceof BrowserRegistryBackpressureError) {
      throw new BrowserServiceError(error.code, error.message, 429, true);
    }
    throw error;
  }
  if (input.command.action === "open") {
    await state.registry.agentNavigate(input.userId, input.threadId, input.command.url);
    return { ok: true as const };
  }
  if (input.command.action === "read") {
    return state.registry.readPage(input.userId, input.threadId);
  }
  if (input.command.action === "screenshot") {
    return state.registry.agentCaptureFrame(input.userId, input.threadId);
  }
  if (input.command.action === "scroll") {
    await state.registry.agentScroll(
      input.userId,
      input.threadId,
      input.command.deltaX,
      input.command.deltaY,
    );
    return { ok: true as const };
  }
  if (input.command.action === "click") {
    await state.registry.agentClick(input.userId, input.threadId, input.command.selector);
    return { ok: true as const };
  }
  if (input.command.action === "type") {
    await state.registry.agentType(
      input.userId,
      input.threadId,
      input.command.selector,
      input.command.text,
      input.command.clear,
    );
    return { ok: true as const };
  }
  if (input.command.action === "tabs") {
    return state.registry.listTabs(input.userId, input.threadId);
  }
  return state.registry.listDownloads(input.userId, input.threadId);
}

/** Stops only the selected employee browser without creating a service instance. */
export async function stopBrowserRuntimeForUser(installationId: string, userId: string) {
  const state = browserGlobal.__aibrainBrowserRuntimeService;
  if (!state) return false;
  ensureBinding(state, installationId, userId);
  return state.registry.stop(userId);
}

export function resetBrowserServiceForTests() {
  const current = browserGlobal.__aibrainBrowserRuntimeService;
  delete browserGlobal.__aibrainBrowserRuntimeService;
  delete browserGlobal.__aibrainBrowserRuntimeServicePromise;
  return current?.registry.close();
}
