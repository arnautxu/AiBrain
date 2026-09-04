import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import {
  atomicWriteJson,
  defineVersionedSchema,
  expectArray,
  expectBoolean,
  expectInteger,
  expectIsoDate,
  expectOneOf,
  expectString,
  recoverAtomicJsonFile,
  ResourceLockManager,
  ValidationContext,
} from "@/storage";
import {
  deriveWorkerRoots,
  validateWorkerUserId,
  WorkerProvisioner,
} from "@/runtime/workers/provisioner";
import {
  BROWSER_STATE_SCHEMA_VERSION,
  type BrowserController,
  type BrowserDownloadState,
  type BrowserLifecycle,
  type BrowserPersistentState,
  type BrowserRecoveryReason,
  type BrowserRoots,
} from "@/runtime/browser/types";

const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIFECYCLES = ["stopped", "starting", "ready", "human-control", "recovering", "degraded"] as const;
const CONTROLLERS = ["none", "agent", "human"] as const;
const RECOVERY_REASONS = ["process_restart", "human_release", "heartbeat_timeout", "runtime_failure"] as const;
const DOWNLOAD_STATUSES = ["active", "complete", "failed"] as const;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_DOWNLOAD_RECORDS = 1_000;

export class BrowserStateError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BrowserStateError";
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function nullableIso(value: unknown, context: ValidationContext) {
  return value === null ? null : expectIsoDate(value, context);
}

function nullableUuid(value: unknown, context: ValidationContext) {
  return value === null ? null : expectString(value, context, {
    minLength: 36,
    maxLength: 36,
    pattern: UUID_PATTERN,
  });
}

function nullableReason(value: unknown, context: ValidationContext): BrowserRecoveryReason | null {
  return value === null ? null : expectOneOf(value, RECOVERY_REASONS, context);
}

function parseDownload(value: unknown, context: ValidationContext): BrowserDownloadState {
  if (!value || typeof value !== "object" || Array.isArray(value)) context.fail("expected an object");
  const record = value as Record<string, unknown>;
  const expected = ["id", "fileName", "status", "sizeBytes", "createdAt", "updatedAt"];
  if (Object.keys(record).sort().join("\0") !== expected.sort().join("\0")) {
    context.fail("download keys do not match the browser state contract");
  }
  const fileName = expectString(record.fileName, context.at("fileName"), {
    minLength: 1,
    maxLength: 255,
  });
  if (fileName !== fileName.trim() || fileName === "." || fileName === ".." ||
    fileName.includes("/") || fileName.includes("\\") || /\p{C}/u.test(fileName)) {
    context.at("fileName").fail("expected a safe basename");
  }
  const createdAt = expectIsoDate(record.createdAt, context.at("createdAt"));
  const updatedAt = expectIsoDate(record.updatedAt, context.at("updatedAt"));
  if (updatedAt < createdAt) context.at("updatedAt").fail("must not precede createdAt");
  let sizeBytes: number | null = null;
  if (record.sizeBytes !== null) {
    sizeBytes = expectInteger(record.sizeBytes, context.at("sizeBytes"), { minimum: 0 });
  }
  return {
    id: expectString(record.id, context.at("id"), {
      minLength: 36,
      maxLength: 36,
      pattern: UUID_PATTERN,
    }),
    fileName,
    status: expectOneOf(record.status, DOWNLOAD_STATUSES, context.at("status")),
    sizeBytes,
    createdAt,
    updatedAt,
  };
}

function assertStateInvariants(state: BrowserPersistentState, context: ValidationContext) {
  const hasSession = state.browserSessionId !== null;
  const hasHeartbeat = state.heartbeatAt !== null && state.heartbeatExpiresAt !== null;
  if ((state.heartbeatAt === null) !== (state.heartbeatExpiresAt === null)) {
    context.at("heartbeatAt").fail("heartbeat timestamps must both be null or both be set");
  }
  if (state.heartbeatAt && state.heartbeatExpiresAt && state.heartbeatExpiresAt <= state.heartbeatAt) {
    context.at("heartbeatExpiresAt").fail("must follow heartbeatAt");
  }
  if (state.lifecycle === "stopped") {
    if (hasSession || state.controller !== "none" || hasHeartbeat) {
      context.fail("stopped browser state must not retain an active session or heartbeat");
    }
  } else if (!hasSession) {
    context.at("browserSessionId").fail("active browser state requires a session id");
  }
  if ((state.lifecycle === "starting" || state.lifecycle === "ready") && state.controller !== "agent") {
    context.at("controller").fail("starting and ready browser states require agent control");
  }
  if (state.lifecycle === "human-control" && state.controller !== "human") {
    context.at("controller").fail("human-control state requires human control");
  }
  if ((state.lifecycle === "recovering" || state.lifecycle === "degraded") && state.controller !== "none") {
    context.at("controller").fail("recovering and degraded states must fail closed without a controller");
  }
  if ((state.lifecycle === "starting" || state.lifecycle === "ready" || state.lifecycle === "human-control") && !hasHeartbeat) {
    context.at("heartbeatAt").fail("controlled browser states require a heartbeat");
  }
  if (state.updatedAt < state.createdAt) context.at("updatedAt").fail("must not precede createdAt");
  const downloadIds = new Set<string>();
  for (const download of state.downloads) {
    if (downloadIds.has(download.id)) context.at("downloads").fail("download ids must be unique");
    downloadIds.add(download.id);
  }
}

export const browserPersistentStateSchema = defineVersionedSchema<BrowserPersistentState>({
  name: "BrowserPersistentState",
  schemaVersion: BROWSER_STATE_SCHEMA_VERSION,
  keys: [
    "installationId",
    "userId",
    "browserSessionId",
    "lifecycle",
    "controller",
    "generation",
    "heartbeatAt",
    "heartbeatExpiresAt",
    "recoveryAttempt",
    "lastRecoveryReason",
    "profileGeneration",
    "profileCleanShutdown",
    "profileLastOpenedAt",
    "downloads",
    "createdAt",
    "updatedAt",
  ],
  parse(record, context) {
    const state: BrowserPersistentState = {
      schemaVersion: BROWSER_STATE_SCHEMA_VERSION,
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2,
        maxLength: 63,
        pattern: INSTALLATION_ID_PATTERN,
      }),
      userId: expectString(record.userId, context.at("userId"), {
        minLength: 36,
        maxLength: 36,
        pattern: UUID_PATTERN,
      }),
      browserSessionId: nullableUuid(record.browserSessionId, context.at("browserSessionId")),
      lifecycle: expectOneOf(record.lifecycle, LIFECYCLES, context.at("lifecycle")) as BrowserLifecycle,
      controller: expectOneOf(record.controller, CONTROLLERS, context.at("controller")) as BrowserController,
      generation: expectInteger(record.generation, context.at("generation"), { minimum: 0 }),
      heartbeatAt: nullableIso(record.heartbeatAt, context.at("heartbeatAt")),
      heartbeatExpiresAt: nullableIso(record.heartbeatExpiresAt, context.at("heartbeatExpiresAt")),
      recoveryAttempt: expectInteger(record.recoveryAttempt, context.at("recoveryAttempt"), { minimum: 0 }),
      lastRecoveryReason: nullableReason(record.lastRecoveryReason, context.at("lastRecoveryReason")),
      profileGeneration: expectInteger(record.profileGeneration, context.at("profileGeneration"), { minimum: 0 }),
      profileCleanShutdown: expectBoolean(record.profileCleanShutdown, context.at("profileCleanShutdown")),
      profileLastOpenedAt: nullableIso(record.profileLastOpenedAt, context.at("profileLastOpenedAt")),
      downloads: expectArray(record.downloads, context.at("downloads"), parseDownload),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
      updatedAt: expectIsoDate(record.updatedAt, context.at("updatedAt")),
    };
    assertStateInvariants(state, context);
    return state;
  },
});

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

async function assertRealDirectory(root: string, candidate: string) {
  const metadata = await lstat(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new BrowserStateError("BROWSER_ROOT_UNSAFE", `Browser root is not a real directory: ${candidate}`);
  }
  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!inside(canonicalRoot, canonicalCandidate)) {
    throw new BrowserStateError("BROWSER_ROOT_ESCAPE", "Browser root resolves outside its user boundary.");
  }
  if ((metadata.mode & 0o777) !== 0o700) await chmod(candidate, 0o700);
}

function newState(installationId: string, userId: string, now: string): BrowserPersistentState {
  return {
    schemaVersion: BROWSER_STATE_SCHEMA_VERSION,
    installationId,
    userId,
    browserSessionId: null,
    lifecycle: "stopped",
    controller: "none",
    generation: 0,
    heartbeatAt: null,
    heartbeatExpiresAt: null,
    recoveryAttempt: 0,
    lastRecoveryReason: null,
    profileGeneration: 0,
    profileCleanShutdown: true,
    profileLastOpenedAt: null,
    downloads: [],
    createdAt: now,
    updatedAt: now,
  };
}

export type BrowserSessionStoreOptions = {
  config: Readonly<InstallationConfig>;
  provisioner?: WorkerProvisioner;
  now?: () => number;
  heartbeatTtlMs?: number;
  maxDownloadRecords?: number;
};

export class BrowserSessionStore {
  readonly config: Readonly<InstallationConfig>;
  readonly provisioner: WorkerProvisioner;
  readonly heartbeatTtlMs: number;
  readonly maxDownloadRecords: number;
  private readonly now: () => number;
  private readonly initializedRoots = new Map<string, Promise<void>>();

  constructor(options: BrowserSessionStoreOptions) {
    this.config = options.config;
    this.provisioner = options.provisioner ?? new WorkerProvisioner({ config: options.config });
    this.now = options.now ?? Date.now;
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? 30_000;
    this.maxDownloadRecords = options.maxDownloadRecords ?? DEFAULT_MAX_DOWNLOAD_RECORDS;
    if (!Number.isSafeInteger(this.heartbeatTtlMs) || this.heartbeatTtlMs < 1_000) {
      throw new BrowserStateError("BROWSER_HEARTBEAT_TTL_INVALID", "Browser heartbeat TTL is invalid.");
    }
    if (!Number.isSafeInteger(this.maxDownloadRecords) ||
      this.maxDownloadRecords < 1 || this.maxDownloadRecords > 10_000) {
      throw new BrowserStateError("BROWSER_DOWNLOAD_RETENTION_INVALID", "Browser download metadata retention is invalid.");
    }
  }

  private iso(timestamp = this.now()) {
    return new Date(timestamp).toISOString();
  }

  private heartbeatWindow() {
    const now = this.now();
    return { heartbeatAt: this.iso(now), heartbeatExpiresAt: this.iso(now + this.heartbeatTtlMs) };
  }

  async roots(userId: string): Promise<BrowserRoots> {
    validateWorkerUserId(userId);
    const expected = deriveWorkerRoots(this.config, userId);
    // Provision once per store, not once per input/frame. This is initialization,
    // never a cached permission/path check: all browser ancestors are checked below.
    let initialization = this.initializedRoots.get(userId);
    if (!initialization) {
      initialization = this.provisioner.provision(userId).then((manifest) => {
        if (manifest.roots.browserRoot !== expected.browserRoot ||
          manifest.roots.browserProfile !== expected.browserProfile ||
          manifest.roots.browserDownloads !== expected.browserDownloads) {
          throw new BrowserStateError("BROWSER_ROOT_MISMATCH", "Browser roots do not match worker provisioning.");
        }
      });
      this.initializedRoots.set(userId, initialization);
      void initialization.catch(() => {
        if (this.initializedRoots.get(userId) === initialization) this.initializedRoots.delete(userId);
      });
    }
    await initialization;
    const root = this.config.paths.dataRoot;
    await assertRealDirectory(root, root);
    let ancestor = root;
    const relative = path.relative(root, expected.userRoot);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new BrowserStateError("BROWSER_ROOT_ESCAPE", "Browser user root escapes installation data.");
    }
    for (const part of relative.split(path.sep)) {
      ancestor = path.join(ancestor, part);
      await assertRealDirectory(root, ancestor);
    }
    await Promise.all([
      assertRealDirectory(expected.userRoot, expected.browserRoot),
      assertRealDirectory(expected.browserRoot, expected.browserProfile),
      assertRealDirectory(expected.browserRoot, expected.browserDownloads),
    ]);
    const lockRoot = path.join(expected.browserRoot, ".locks");
    try {
      await mkdir(lockRoot, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertRealDirectory(expected.browserRoot, lockRoot);
    return Object.freeze({
      browserRoot: expected.browserRoot,
      profile: expected.browserProfile,
      downloads: expected.browserDownloads,
      stateFile: path.join(expected.browserRoot, "session.json"),
    });
  }

  private lockManager(roots: BrowserRoots) {
    return new ResourceLockManager({ rootDirectory: path.join(roots.browserRoot, ".locks") });
  }

  private async assertStateFileSafe(stateFile: string) {
    try {
      const metadata = await lstat(stateFile);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        metadata.size > MAX_STATE_BYTES || (metadata.mode & 0o077) !== 0) {
        throw new BrowserStateError("BROWSER_STATE_UNSAFE", "Browser state file is not private and regular.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  private async writeUnlocked(stateFile: string, state: BrowserPersistentState) {
    const validated = browserPersistentStateSchema.parse(state, stateFile);
    if (Buffer.byteLength(JSON.stringify(validated), "utf8") > MAX_STATE_BYTES) {
      throw new BrowserStateError("BROWSER_STATE_BACKPRESSURE", "Browser state exceeds its safe operational size.");
    }
    await atomicWriteJson(stateFile, validated, browserPersistentStateSchema, { mode: 0o600 });
    await chmod(stateFile, 0o600);
  }

  private async readUnlocked(userId: string, roots: BrowserRoots) {
    await this.assertStateFileSafe(roots.stateFile);
    let state: BrowserPersistentState;
    try {
      state = (await recoverAtomicJsonFile(roots.stateFile, browserPersistentStateSchema)).value;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      state = newState(this.config.installationId, userId, this.iso());
      await this.writeUnlocked(roots.stateFile, state);
    }
    if (state.installationId !== this.config.installationId || state.userId !== userId) {
      throw new BrowserStateError("BROWSER_STATE_BINDING_MISMATCH", "Browser state belongs to another installation or user.");
    }
    return state;
  }

  private async mutate<T>(
    userId: string,
    operation: (state: BrowserPersistentState) => T | Promise<T>,
    shouldWrite: (result: T) => boolean = () => true,
  ) {
    const roots = await this.roots(userId);
    return this.lockManager(roots).withLock(`browser-state:${this.config.installationId}:${userId}`, async () => {
      const state = await this.readUnlocked(userId, roots);
      const result = await operation(state);
      if (shouldWrite(result)) {
        state.updatedAt = this.iso();
        await this.writeUnlocked(roots.stateFile, state);
      }
      return result;
    });
  }

  async load(userId: string) {
    const roots = await this.roots(userId);
    return this.lockManager(roots).withLock(
      `browser-state:${this.config.installationId}:${userId}`,
      () => this.readUnlocked(userId, roots),
    );
  }

  async createSession(userId: string) {
    return this.mutate(userId, (state) => {
      if (state.lifecycle !== "stopped") {
        throw new BrowserStateError("BROWSER_SESSION_ACTIVE", "Browser session is already active.");
      }
      const now = this.iso();
      state.browserSessionId = randomUUID();
      state.lifecycle = "starting";
      state.controller = "agent";
      state.generation += 1;
      Object.assign(state, this.heartbeatWindow());
      state.lastRecoveryReason = null;
      state.profileGeneration += 1;
      state.profileCleanShutdown = false;
      state.profileLastOpenedAt = now;
      return state;
    });
  }

  async beginRecovery(userId: string, sessionId: string, reason: BrowserRecoveryReason) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      if (state.lifecycle === "stopped") {
        throw new BrowserStateError("BROWSER_SESSION_STOPPED", "Stopped browser session cannot recover.");
      }
      // Rotate the gateway binding on every recovery so stale viewers,
      // heartbeats and pre-restart controllers are fenced immediately.
      state.browserSessionId = randomUUID();
      state.lifecycle = "recovering";
      state.controller = "none";
      state.heartbeatAt = null;
      state.heartbeatExpiresAt = null;
      state.recoveryAttempt += 1;
      state.lastRecoveryReason = reason;
      if (reason !== "human_release") this.failActiveDownloads(state);
      return state;
    });
  }

  async markReady(userId: string, sessionId: string) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      if (state.lifecycle !== "starting" && state.lifecycle !== "recovering") {
        throw new BrowserStateError("BROWSER_TRANSITION_INVALID", "Browser cannot become ready from its current state.");
      }
      if (state.lifecycle === "recovering") state.generation += 1;
      state.lifecycle = "ready";
      state.controller = "agent";
      Object.assign(state, this.heartbeatWindow());
      return state;
    });
  }

  async heartbeat(userId: string, sessionId: string, controller: Exclude<BrowserController, "none">) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      const expectedLifecycle = controller === "agent" ? "ready" : "human-control";
      if (state.lifecycle !== expectedLifecycle || state.controller !== controller) {
        throw new BrowserStateError("BROWSER_HEARTBEAT_REJECTED", "Heartbeat controller does not own this browser session.");
      }
      Object.assign(state, this.heartbeatWindow());
      return state;
    });
  }

  async takeOver(userId: string, sessionId: string) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      if (state.lifecycle !== "ready" && state.lifecycle !== "human-control") {
        throw new BrowserStateError("BROWSER_TRANSITION_INVALID", "Browser is not ready for takeover.");
      }
      state.lifecycle = "human-control";
      state.controller = "human";
      Object.assign(state, this.heartbeatWindow());
      return state;
    });
  }

  async releaseTakeover(userId: string, sessionId: string) {
    return this.beginRecovery(userId, sessionId, "human_release");
  }

  async recoverExpired(userId: string) {
    return this.mutate(userId, (state) => {
      if (!state.browserSessionId || !state.heartbeatExpiresAt ||
        Date.parse(state.heartbeatExpiresAt) > this.now() ||
        (state.lifecycle !== "starting" && state.lifecycle !== "ready" && state.lifecycle !== "human-control")) {
        return { changed: false, state } as const;
      }
      state.lifecycle = "recovering";
      state.browserSessionId = randomUUID();
      state.controller = "none";
      state.heartbeatAt = null;
      state.heartbeatExpiresAt = null;
      state.recoveryAttempt += 1;
      state.lastRecoveryReason = "heartbeat_timeout";
      this.failActiveDownloads(state);
      return { changed: true, state } as const;
    }, (result) => result.changed);
  }

  async markDegraded(userId: string, sessionId: string) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      state.lifecycle = "degraded";
      state.controller = "none";
      state.heartbeatAt = null;
      state.heartbeatExpiresAt = null;
      state.lastRecoveryReason = "runtime_failure";
      this.failActiveDownloads(state);
      return state;
    });
  }

  async stop(userId: string, sessionId: string, cleanShutdown: boolean) {
    return this.mutate(userId, (state) => {
      this.assertSession(state, sessionId);
      state.browserSessionId = null;
      state.lifecycle = "stopped";
      state.controller = "none";
      state.heartbeatAt = null;
      state.heartbeatExpiresAt = null;
      state.profileCleanShutdown = cleanShutdown;
      this.failActiveDownloads(state);
      return state;
    });
  }

  async startDownload(userId: string, sessionId: string, fileName: string) {
    return this.mutate(userId, (state) => {
      this.assertControlledSession(state, sessionId);
      const now = this.iso();
      if (state.downloads.length >= this.maxDownloadRecords) {
        const removable = state.downloads.length - this.maxDownloadRecords + 1;
        let removed = 0;
        state.downloads = state.downloads.filter((download) => {
          if (removed < removable && download.status !== "active") {
            removed += 1;
            return false;
          }
          return true;
        });
        if (state.downloads.length >= this.maxDownloadRecords) {
          throw new BrowserStateError(
            "BROWSER_DOWNLOAD_BACKPRESSURE",
            "Too many active browser downloads; retry after existing downloads settle.",
          );
        }
      }
      const download = parseDownload({
        id: randomUUID(),
        fileName,
        status: "active",
        sizeBytes: null,
        createdAt: now,
        updatedAt: now,
      }, new ValidationContext("BrowserDownloadState", "runtime"));
      state.downloads.push(download);
      return download;
    });
  }

  async finishDownload(
    userId: string,
    sessionId: string,
    downloadId: string,
    result: { status: "complete"; sizeBytes: number } | { status: "failed" },
  ) {
    return this.mutate(userId, (state) => {
      this.assertControlledSession(state, sessionId);
      const download = state.downloads.find((candidate) => candidate.id === downloadId);
      if (!download || download.status !== "active") {
        throw new BrowserStateError("BROWSER_DOWNLOAD_NOT_FOUND", "Active browser download was not found.");
      }
      download.status = result.status;
      download.sizeBytes = result.status === "complete" ? result.sizeBytes : null;
      download.updatedAt = this.iso();
      return download;
    });
  }

  private assertSession(state: BrowserPersistentState, sessionId: string) {
    if (!UUID_PATTERN.test(sessionId) || state.browserSessionId !== sessionId) {
      throw new BrowserStateError("BROWSER_SESSION_MISMATCH", "Browser session does not match this user.");
    }
  }

  private failActiveDownloads(state: BrowserPersistentState) {
    const now = this.iso();
    for (const download of state.downloads) {
      if (download.status !== "active") continue;
      download.status = "failed";
      download.sizeBytes = null;
      download.updatedAt = now;
    }
  }

  private assertControlledSession(state: BrowserPersistentState, sessionId: string) {
    this.assertSession(state, sessionId);
    if (state.lifecycle !== "ready" && state.lifecycle !== "human-control") {
      throw new BrowserStateError("BROWSER_SESSION_NOT_READY", "Browser session is not controlled and ready.");
    }
  }
}
