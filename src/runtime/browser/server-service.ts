import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import { loadInstallationConfig } from "@/config/installation";
import { getSigningSecret } from "@/auth/session";
import { FileLocalUserStore } from "@/auth/local-user-store";
import { BrowserGatewayTokenService } from "@/runtime/browser/gateway-token";
import {
  ChromeBrowserRuntimeFactory,
  ChromeRuntimeError,
  probeChromeRuntimeCapability,
} from "@/runtime/browser/chrome-runtime";
import { CdpClientError } from "@/runtime/browser/cdp-client";
import {
  BrowserRegistryBackpressureError,
  BrowserRuntimeRegistry,
} from "@/runtime/browser/registry";
import { BrowserSessionStore } from "@/runtime/browser/state-store";
import type {
  BrowserGatewayCapability,
  BrowserInputCommand,
  BrowserViewerHistoryAction,
  BrowserViewerNavigationState,
} from "@/runtime/browser/types";
import { validateWorkerUserId } from "@/runtime/workers/provisioner";
import { featurePolicyForIdentity } from "@/settings/server-service";
import {
  assertBrowserApprovalEvidence,
  browserEvidenceHash,
  browserInteractionRequiresApproval,
  type BrowserActionResourceSnapshot,
  type BrowserInformedApprovalEvidence,
} from "@/runtime/browser/action-evidence";
import { BrowserActionHistoryStore } from "@/runtime/browser/action-history";

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

const DEFAULT_BROWSER_OPERATION_TIMEOUT_MS = 30_000;
const MIN_BROWSER_OPERATION_TIMEOUT_MS = 1_000;
const MAX_BROWSER_OPERATION_TIMEOUT_MS = 120_000;

function browserOperationTimeoutMs() {
  const configured = Number(process.env.AIBRAIN_BROWSER_OPERATION_TIMEOUT_MS || DEFAULT_BROWSER_OPERATION_TIMEOUT_MS);
  if (!Number.isSafeInteger(configured) || configured < MIN_BROWSER_OPERATION_TIMEOUT_MS ||
    configured > MAX_BROWSER_OPERATION_TIMEOUT_MS) {
    return DEFAULT_BROWSER_OPERATION_TIMEOUT_MS;
  }
  return configured;
}

function browserOperationFailure(code: "BROWSER_OPERATION_TIMEOUT" | "BROWSER_OPERATION_CANCELLED") {
  return new BrowserServiceError(
    code,
    code === "BROWSER_OPERATION_CANCELLED"
      ? "Browser operation was cancelled and its private session is being recovered."
      : "Browser operation timed out and its private session is being recovered.",
    code === "BROWSER_OPERATION_CANCELLED" ? 499 : 504,
    true,
  );
}

async function withBrowserOperationDeadline<Result>(
  operation: () => Promise<Result>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw browserOperationFailure("BROWSER_OPERATION_CANCELLED");
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let removeAbort: () => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(browserOperationFailure("BROWSER_OPERATION_TIMEOUT")),
      browserOperationTimeoutMs(),
    );
    timeout.unref?.();
    if (signal) {
      const abort = () => reject(browserOperationFailure("BROWSER_OPERATION_CANCELLED"));
      signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", abort);
    }
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    removeAbort();
  }
}

function isBrowserOperationDeadline(error: unknown) {
  return error instanceof BrowserServiceError &&
    (error.code === "BROWSER_OPERATION_TIMEOUT" || error.code === "BROWSER_OPERATION_CANCELLED");
}

type BrowserServiceState = {
  fingerprint: string;
  config: Readonly<InstallationConfig>;
  registry: BrowserRuntimeRegistry;
  tokens: BrowserGatewayTokenService;
  viewerStreams: Map<string, AbortController>;
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
  if (existing?.fingerprint === fingerprint) {
    // Dev hot reloads can retain a service created before viewer attachment
    // fencing was introduced. Upgrade that process-local state in place.
    existing.viewerStreams ??= new Map();
    return existing;
  }
  const inFlight = browserGlobal.__aibrainBrowserRuntimeServicePromise;
  if (inFlight) {
    const initialized = await inFlight;
    return initialized.fingerprint === fingerprint ? initialized : serviceState();
  }
  const initialize = (async () => {
    const replaced = browserGlobal.__aibrainBrowserRuntimeService;
    if (replaced) {
      for (const controller of replaced.viewerStreams?.values() ?? []) controller.abort();
      replaced.viewerStreams?.clear();
      await replaced.registry.close();
    }
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
      viewerStreams: new Map(),
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

async function browserCapability() {
  return probeChromeRuntimeCapability({
    executablePath: process.env.AIBRAIN_CHROME_BIN?.trim() || undefined,
    expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION?.trim() || undefined,
  });
}

async function ensureBrowserCapability() {
  const capability = await browserCapability();
  if (!capability.available) {
    throw new BrowserServiceError(
      capability.code ?? "CHROME_CAPABILITY_UNAVAILABLE",
      "The managed Chrome capability is not available on this server.",
      503,
      true,
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
  const [health, capability] = await Promise.all([
    state.registry.health(userId),
    browserCapability(),
  ]);
  return {
    available: capability.available,
    capabilityCode: capability.code,
    healthy: capability.available && health.healthy,
    state: health.state,
    runtime: health.runtime,
    runningInProcess: state.registry.get(userId) !== null,
  };
}

export async function browserActionHistory(
  installationId: string,
  userId: string,
  threadId: string,
  limit = 50,
) {
  const state = await serviceState();
  ensureBinding(state, installationId, userId);
  await ensureEnabledUser(state, userId);
  await ensureBrowserEnabled(installationId, userId);
  const roots = await state.registry.store.roots(userId);
  return new BrowserActionHistoryStore({
    userRoot: path.dirname(roots.browserRoot),
  }).list(threadId, limit);
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
  if (action !== "stop") await ensureBrowserCapability();
  try {
    if (action === "start") await state.registry.start(userId);
    else if (action === "stop") {
      await state.registry.stop(userId);
      const capability = await browserCapability();
      return {
        available: capability.available,
        capabilityCode: capability.code,
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
  await ensureBrowserCapability();
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
  await ensureBrowserCapability();
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

async function executeViewerOperation<Result>(input: {
  registry: BrowserRuntimeRegistry;
  userId: string;
  operation: () => Promise<Result>;
  signal?: AbortSignal;
  recoverOnCancellation?: boolean;
}) {
  try {
    return await withBrowserOperationDeadline(input.operation, input.signal);
  } catch (error) {
    if (viewerOperationRequiresProcessRecovery(error, input.recoverOnCancellation)) {
      await recoverBrowserProcess(input.registry, input.userId);
    }
    throw error;
  }
}

export function viewerOperationRequiresProcessRecovery(
  error: unknown,
  recoverOnCancellation = true,
) {
  const normalViewerDetach = recoverOnCancellation === false &&
    error instanceof BrowserServiceError && error.code === "BROWSER_OPERATION_CANCELLED";
  return !normalViewerDetach && shouldRecoverBrowserProcess(error);
}

export async function captureBrowserFrame(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  signal?: AbortSignal;
}) {
  const state = await authorizeGateway({ ...input, capability: "view" });
  return executeViewerOperation({
    registry: state.registry,
    userId: input.userId,
    signal: input.signal,
    recoverOnCancellation: false,
    operation: () => state.registry.captureFrame(input.userId, input.threadId),
  });
}

export type BrowserFrameStreamEvent = Readonly<{
  kind: "frame" | "heartbeat";
  sequence: number;
  capturedAt: string;
  captureDurationMs: number;
  mediaType: "image/png" | null;
  data: Uint8Array;
}>;

function waitForNextFrame(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Authenticates once, then emits only changed frames over one bounded stream.
 * Heartbeats keep idle pages attached without exposing Chrome or CDP details.
 */
export async function* streamBrowserFrames(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  signal: AbortSignal;
  frameIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maximumDurationMs?: number;
}): AsyncGenerator<BrowserFrameStreamEvent> {
  const state = await authorizeGateway({ ...input, capability: "view" });
  const streamKey = `${input.userId}:${input.threadId}`;
  const streamController = new AbortController();
  const previousStream = state.viewerStreams.get(streamKey);
  state.viewerStreams.set(streamKey, streamController);
  previousStream?.abort();
  const detach = () => streamController.abort();
  input.signal.addEventListener("abort", detach, { once: true });
  if (input.signal.aborted) detach();
  const frameIntervalMs = Math.max(100, Math.min(1_000, input.frameIntervalMs ?? 180));
  const heartbeatIntervalMs = Math.max(1_000, Math.min(10_000, input.heartbeatIntervalMs ?? 2_500));
  const maximumDurationMs = Math.max(1_000, Math.min(25_000, input.maximumDurationMs ?? 20_000));
  const deadline = Date.now() + maximumDurationMs;
  let sequence = 0;
  let lastDigest: string | null = null;
  let lastEmissionAt = 0;
  try {
    while (!streamController.signal.aborted && Date.now() < deadline) {
      const captureStartedAt = Date.now();
      const frame = await executeViewerOperation({
        registry: state.registry,
        userId: input.userId,
        signal: streamController.signal,
        recoverOnCancellation: false,
        operation: () => state.registry.captureFrame(input.userId, input.threadId),
      });
      if (streamController.signal.aborted) break;
      const data = Buffer.from(frame.dataBase64, "base64");
      const digest = createHash("sha256").update(data).digest("hex");
      const captureDurationMs = Math.max(0, Date.now() - captureStartedAt);
      if (digest !== lastDigest) {
        sequence += 1;
        lastDigest = digest;
        lastEmissionAt = Date.now();
        yield Object.freeze({
          kind: "frame" as const,
          sequence,
          capturedAt: frame.capturedAt,
          captureDurationMs,
          mediaType: frame.mediaType,
          data: new Uint8Array(data),
        });
      } else if (Date.now() - lastEmissionAt >= heartbeatIntervalMs) {
        lastEmissionAt = Date.now();
        yield Object.freeze({
          kind: "heartbeat" as const,
          sequence,
          capturedAt: new Date().toISOString(),
          captureDurationMs,
          mediaType: null,
          data: new Uint8Array(0),
        });
      }
      await waitForNextFrame(
        frameIntervalMs - (Date.now() - captureStartedAt),
        streamController.signal,
      );
    }
  } catch (error) {
    if (!streamController.signal.aborted) throw error;
  } finally {
    input.signal.removeEventListener("abort", detach);
    if (state.viewerStreams.get(streamKey) === streamController) {
      state.viewerStreams.delete(streamKey);
    }
  }
}

export async function browserViewerNavigationState(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  signal?: AbortSignal;
}) {
  const state = await authorizeGateway({ ...input, capability: "view" });
  return executeViewerOperation({
    registry: state.registry,
    userId: input.userId,
    signal: input.signal,
    recoverOnCancellation: false,
    operation: () => state.registry.viewerNavigationState(input.userId, input.threadId),
  });
}

export async function sendBrowserViewerCommand(input: {
  installationId: string;
  userId: string;
  authSessionId: string;
  threadId: string;
  token: string;
  signal?: AbortSignal;
  command:
    | { action: "navigate"; url: string }
    | { action: "history"; direction: BrowserViewerHistoryAction }
    | { action: "input"; command: BrowserInputCommand };
}) {
  const state = await authorizeGateway({ ...input, capability: "control" });
  const command = input.command;
  let navigationState: BrowserViewerNavigationState | undefined;
  if (command.action === "navigate") {
    navigationState = await executeViewerOperation({
      registry: state.registry,
      userId: input.userId,
      signal: input.signal,
      operation: async () => {
        await state.registry.navigate(input.userId, input.threadId, command.url);
        return state.registry.viewerNavigationState(input.userId, input.threadId);
      },
    });
  } else if (command.action === "history") {
    navigationState = await executeViewerOperation({
      registry: state.registry,
      userId: input.userId,
      signal: input.signal,
      operation: () => state.registry.navigateHistory(input.userId, input.threadId, command.direction),
    });
  } else {
    await executeViewerOperation({
      registry: state.registry,
      userId: input.userId,
      signal: input.signal,
      operation: () => state.registry.dispatchInput(input.userId, input.threadId, command.command),
    });
  }
  const action = command.action === "navigate"
    ? "open"
    : command.action === "history"
      ? "open"
      : command.command.event === "mouseWheel"
        ? "scroll"
        : command.command.event === "mouseReleased"
          ? "click"
          : command.command.event === "keyDown"
            ? "type"
            : null;
  if (action) {
    const roots = await state.registry.store.roots(input.userId);
    await new BrowserActionHistoryStore({ userRoot: path.dirname(roots.browserRoot) }).append({
      schemaVersion: 1,
      installationId: input.installationId,
      userId: input.userId,
      threadId: input.threadId,
      turnId: "manual-takeover",
      callId: randomUUID(),
      action,
      phase: "dispatched",
      success: true,
      actor: "human",
    }).catch(() => null);
  }
  return navigationState;
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

export type BrowserMutationCommand = Extract<
  BrowserAgentCommand,
  { action: "open" | "scroll" | "click" | "type" }
>;

function isBrowserMutation(command: BrowserAgentCommand): command is BrowserMutationCommand {
  return command.action === "open" || command.action === "scroll" ||
    command.action === "click" || command.action === "type";
}

function isRecoverableBrowserReadFailure(error: unknown) {
  return (error instanceof CdpClientError && [
    "CDP_PIPE_EOF",
    "CDP_CLOSED",
    "CDP_PIPE_READ_FAILED",
    "CDP_PIPE_WRITE_FAILED",
    "CDP_SEND_FAILED",
    "CDP_COMMAND_TIMEOUT",
    "CDP_EVENT_TIMEOUT",
  ].includes(error.code)) || (error instanceof ChromeRuntimeError && [
    "CHROME_NOT_RUNNING",
    "CHROME_PAGE_STATE_INVALID",
  ].includes(error.code));
}

function shouldRecoverBrowserProcess(error: unknown) {
  return isBrowserOperationDeadline(error) || isRecoverableBrowserReadFailure(error);
}

async function recoverBrowserProcess(
  registry: BrowserRuntimeRegistry,
  userId: string,
) {
  await registry.restart(userId);
}

async function executeBrowserReadWithRecovery<Result>(
  registry: BrowserRuntimeRegistry,
  userId: string,
  operation: () => Promise<Result>,
  signal?: AbortSignal,
) {
  try {
    return await withBrowserOperationDeadline(operation, signal);
  } catch (error) {
    if (!shouldRecoverBrowserProcess(error)) throw error;
    await recoverBrowserProcess(registry, userId);
    if (signal?.aborted) throw browserOperationFailure("BROWSER_OPERATION_CANCELLED");
    return withBrowserOperationDeadline(operation, signal);
  }
}

async function agentRegistry(input: { installationId: string; userId: string }) {
  const state = await serviceState();
  ensureBinding(state, input.installationId, input.userId);
  await ensureBrowserEnabled(input.installationId, input.userId);
  await ensureEnabledUser(state, input.userId);
  await ensureBrowserCapability();
  try {
    await state.registry.start(input.userId);
  } catch (error) {
    if (error instanceof BrowserRegistryBackpressureError) {
      throw new BrowserServiceError(error.code, error.message, 429, true);
    }
    throw error;
  }
  return state.registry;
}

/** Captures the exact page and target that a mutation approval describes. */
export async function prepareBrowserAgentCommand(input: {
  installationId: string;
  userId: string;
  threadId: string;
  command: BrowserMutationCommand;
  signal?: AbortSignal;
}): Promise<BrowserActionResourceSnapshot> {
  const registry = await agentRegistry(input);
  try {
    return await withBrowserOperationDeadline(
      () => registry.prepareAgentMutation(input.userId, input.threadId, input.command),
      input.signal,
    );
  } catch (error) {
    if (shouldRecoverBrowserProcess(error)) await recoverBrowserProcess(registry, input.userId);
    throw error;
  }
}

/** Closed, typed browser surface for server-owned Codex dynamic tools. */
export async function executeBrowserAgentCommand(input: {
  installationId: string;
  userId: string;
  threadId: string;
  command: BrowserAgentCommand;
  approvalEvidence?: BrowserInformedApprovalEvidence;
  expectedResource?: BrowserActionResourceSnapshot;
  signal?: AbortSignal;
}) {
  const registry = await agentRegistry(input);
  if (isBrowserMutation(input.command)) {
    const command = input.command;
    if (!input.expectedResource) {
      throw new BrowserServiceError(
        "BROWSER_ACTION_TARGET_EVIDENCE_REQUIRED",
        "Browser interaction requires server-bound target evidence.",
        409,
      );
    }
    const approvalRequired = browserInteractionRequiresApproval(input.command, input.expectedResource);
    if (approvalRequired && !input.approvalEvidence) {
      throw new BrowserServiceError(
        "BROWSER_ACTION_APPROVAL_REQUIRED",
        "Sensitive browser interaction requires explicit approval.",
        409,
      );
    }
    let evidenceFingerprint: string;
    if (input.approvalEvidence) {
      const evidence = assertBrowserApprovalEvidence(input.approvalEvidence);
      if (evidence.installationId !== input.installationId || evidence.userId !== input.userId ||
        evidence.actionKind !== input.command.action || evidence.resource.scopeId !== input.threadId ||
        evidence.resource.kind !== input.expectedResource.kind ||
        evidence.resource.origin !== input.expectedResource.origin ||
        evidence.resource.scopeId !== input.expectedResource.scopeId ||
        evidence.resource.generation !== input.expectedResource.generation ||
        evidence.resource.version !== input.expectedResource.version ||
        evidence.resource.locatorHash !== input.expectedResource.locatorHash ||
        Date.parse(evidence.expiresAt) <= Date.now()) {
        throw new BrowserServiceError(
          "BROWSER_ACTION_EVIDENCE_MISMATCH",
          "Browser action evidence is expired or does not match this execution.",
          409,
        );
      }
      evidenceFingerprint = evidence.evidenceFingerprint;
    } else {
      evidenceFingerprint = browserEvidenceHash({
        mode: "routine",
        installationId: input.installationId,
        userId: input.userId,
        threadId: input.threadId,
        actionKind: input.command.action,
        resource: input.expectedResource,
      });
    }
    try {
      return await withBrowserOperationDeadline(
        () => registry.executeAgentMutation(
          input.userId,
          input.threadId,
          command,
          input.expectedResource as BrowserActionResourceSnapshot,
          evidenceFingerprint,
        ),
        input.signal,
      );
    } catch (error) {
      // A mutation is never replayed after dispatch may have started.  Fencing
      // the exact employee process makes the next action recover on a fresh
      // session while the durable call record remains indeterminate.
      await recoverBrowserProcess(registry, input.userId);
      throw error;
    }
  }
  if (input.command.action === "read") {
    return executeBrowserReadWithRecovery(
      registry,
      input.userId,
      () => registry.readPage(input.userId, input.threadId),
      input.signal,
    );
  }
  if (input.command.action === "screenshot") {
    return executeBrowserReadWithRecovery(
      registry,
      input.userId,
      () => registry.agentCaptureFrame(input.userId, input.threadId),
      input.signal,
    );
  }
  if (input.command.action === "tabs") {
    return executeBrowserReadWithRecovery(
      registry,
      input.userId,
      () => registry.listTabs(input.userId, input.threadId),
      input.signal,
    );
  }
  return executeBrowserReadWithRecovery(
    registry,
    input.userId,
    () => registry.listDownloads(input.userId, input.threadId),
    input.signal,
  );
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
