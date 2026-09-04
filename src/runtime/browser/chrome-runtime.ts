import { constants } from "node:fs";
import { access, chmod, link, lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import path from "node:path";
import {
  browserEvidenceHash,
  sameBrowserActionResource,
  type BrowserActionReadback,
  type BrowserActionResourceSnapshot,
  type BrowserMutationAction,
} from "@/runtime/browser/action-evidence";
import type {
  ApprovalBoundManagedBrowserRuntime,
  BrowserDownloadSnapshot,
  BrowserFrame,
  BrowserInputCommand,
  BrowserPageSnapshot,
  BrowserPointerTrailPoint,
  BrowserRuntimeContext,
  BrowserRuntimeFactory,
  BrowserRuntimeHealth,
  BrowserViewerHistoryAction,
  BrowserViewerNavigationState,
} from "@/runtime/browser/types";
import {
  CdpClientError,
  PrivateCdpClient,
  type CdpSessionScope,
  type PrivateCdpClientOptions,
  type PrivateCdpMethod,
} from "@/runtime/browser/cdp-client";
import { BrowserEgressProxy, browserDnsLookupFromEnvironment } from "@/runtime/browser/egress-proxy";
import { BrowserNavigationStore } from "@/runtime/browser/navigation-store";
import { BrowserNetworkPolicy } from "@/runtime/browser/network-policy";

const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/u;
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
// Leave headroom in the bounded CDP command queue for navigation, health and
// viewer traffic while a request-heavy page is resolving its subresources.
const MAX_INTERCEPTED_REQUESTS = 24;
const MAX_QUEUED_BROWSER_OPERATIONS = 64;
const BROWSER_VIEWPORT_WIDTH = 1_440;
const BROWSER_VIEWPORT_HEIGHT = 900;
const MAX_POINTER_TRAIL_POINTS = 3;
const MAX_QUARANTINE_ENTRIES = 1_024;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PAGE_TEXT_CHARS = 20_000;
const MAX_PAGE_LINKS = 40;
const MAX_PAGE_LINK_TEXT_CHARS = 240;
const MAX_PAGE_LINK_HREF_CHARS = 1_200;
const MAX_SELECTOR_BYTES = 1_000;
const MAX_TYPE_TEXT_BYTES = 32_000;
const MAX_LISTED_DOWNLOADS = 100;

export class ChromeRuntimeError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "ChromeRuntimeError";
  }
}

type ChromeProcess = {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stderr: null | { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  readonly stdio: readonly unknown[];
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

export type CdpClientLike = {
  readonly isOpen: boolean;
  send<Result = unknown>(
    method: PrivateCdpMethod,
    params?: Record<string, unknown>,
    scope?: CdpSessionScope,
  ): Promise<Result>;
  on(method: string, listener: (params: unknown) => void, scope?: CdpSessionScope): () => void;
  close(): Promise<void>;
};

type RuntimeDependencies = {
  spawnProcess?: (executable: string, args: readonly string[], options: SpawnOptions) => ChromeProcess;
  connectCdpPipe?: (
    requestPipe: Writable,
    responsePipe: Readable,
    options: PrivateCdpClientOptions,
  ) => CdpClientLike;
  networkPolicy?: BrowserNetworkPolicy;
  now?: () => number;
};

export type ChromeCdpRuntimeOptions = RuntimeDependencies & {
  executablePath?: string;
  expectedVersion?: string;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxThreadTargets?: number;
  allowPrivateNetwork?: boolean;
};

export type ChromeBrowserRuntimeFactoryOptions = Pick<
  ChromeCdpRuntimeOptions,
  "allowPrivateNetwork" | "executablePath" | "expectedVersion" | "startupTimeoutMs" |
  "maxThreadTargets"
>;

type ThreadPage = {
  readonly threadId: string;
  readonly targetId: string;
  readonly sessionId: string;
  readonly downloadsPath: string;
  heldMouse: { x: number; y: number } | null;
  readonly downloads: Map<string, Readonly<{
    fileName: string;
    projectionId: Promise<string | null>;
  }>>;
  fetchUnsubscribe: (() => void) | null;
  authUnsubscribe: (() => void) | null;
  navigationUnsubscribe: (() => void) | null;
  downloadUnsubscribes: Array<() => void>;
  interceptedRequests: number;
  documentGeneration: number;
  documentVersion: string;
  closed: boolean;
};

type BrowserMutationCommand = Readonly<{
  action: BrowserMutationAction;
  url?: string;
  selector?: string;
  deltaX?: number;
  deltaY?: number;
  text?: string;
  clear?: boolean;
}>;

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRecoverableThreadSessionError(error: unknown) {
  if (!(error instanceof CdpClientError) || error.code !== "CDP_COMMAND_FAILED") return false;
  return /(?:not attached to an active page|session.*(?:not found|closed|does not exist)|no target with given id|target.*(?:closed|navigated)|execution context.*destroyed)/iu
    .test(error.message);
}

function positiveInteger(name: string, value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ChromeRuntimeError("CHROME_OPTIONS_INVALID", `${name} must be between 1 and ${maximum}.`);
  }
  return value;
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertPrivateDirectory(browserRoot: string, candidate: string, label: string) {
  if (!path.isAbsolute(browserRoot) || !path.isAbsolute(candidate) || !inside(browserRoot, candidate)) {
    throw new ChromeRuntimeError("CHROME_ROOT_INVALID", `${label} must be inside browserRoot.`);
  }
  const metadata = await lstat(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ChromeRuntimeError("CHROME_ROOT_UNSAFE", `${label} must be a real directory.`);
  }
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(browserRoot),
    realpath(candidate),
  ]);
  if (!inside(canonicalRoot, canonicalCandidate)) {
    throw new ChromeRuntimeError("CHROME_ROOT_ESCAPE", `${label} resolves outside browserRoot.`);
  }
  await chmod(candidate, 0o700);
}

async function ensurePrivateSubdirectory(browserRoot: string, relativePath: string) {
  if (!/^[a-z][a-z0-9-]{0,63}(?:\/[a-z][a-z0-9-]{0,63})*$/u.test(relativePath)) {
    throw new ChromeRuntimeError("CHROME_ROOT_INVALID", "Private browser subdirectory is invalid.");
  }
  let current = browserRoot;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertPrivateDirectory(browserRoot, current, "browser runtime directory");
  }
  return current;
}

export function validateBrowserNavigationUrl(value: string) {
  if (value === "about:blank") return value;
  if (value.length > 8_192) {
    throw new ChromeRuntimeError("CHROME_NAVIGATION_REJECTED", "Navigation URL is too long.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ChromeRuntimeError("CHROME_NAVIGATION_REJECTED", "Navigation URL is invalid.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username || parsed.password) {
    throw new ChromeRuntimeError(
      "CHROME_NAVIGATION_REJECTED",
      "Only credential-free HTTP, HTTPS and about:blank navigation is allowed.",
    );
  }
  return parsed.toString();
}

function extractBrowserVersion(product: unknown) {
  if (typeof product !== "string") {
    throw new ChromeRuntimeError("CHROME_VERSION_INVALID", "Chrome did not report a product version.");
  }
  const match = product.match(/^(?:HeadlessChrome|Chrome|Chromium)\/(\d+\.\d+\.\d+\.\d+)$/u);
  if (!match) throw new ChromeRuntimeError("CHROME_VERSION_INVALID", "Chrome product version is invalid.");
  return match[1];
}

function validateExpectedVersion(expectedVersion: string | undefined) {
  const normalized = expectedVersion?.trim() || undefined;
  if (process.env.NODE_ENV === "production" && !normalized) {
    throw new ChromeRuntimeError(
      "CHROME_VERSION_REQUIRED",
      "An exact expected Chrome version is required in production.",
    );
  }
  if (normalized && !VERSION_PATTERN.test(normalized)) {
    throw new ChromeRuntimeError("CHROME_VERSION_INVALID", "Expected Chrome version must contain four numeric components.");
  }
  return normalized;
}

function normalizePrivateProxyUrl(value: string | null) {
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new ChromeRuntimeError("CHROME_PROXY_URL_INVALID", "Chrome proxy URL is invalid.", { cause: error });
  }
  const port = Number(parsed.port);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
    !Number.isSafeInteger(port) || port < 1 || port > 65_535 ||
    parsed.username || parsed.password || parsed.pathname !== "/" ||
    parsed.search || parsed.hash) {
    throw new ChromeRuntimeError(
      "CHROME_PROXY_URL_INVALID",
      "Chrome proxy must be an unauthenticated ephemeral IPv4 loopback URL.",
    );
  }
  return parsed.origin;
}

export function buildChromeArguments(context: BrowserRuntimeContext, egressProxyUrl: string | null) {
  const proxyUrl = normalizePrivateProxyUrl(egressProxyUrl);
  const args = [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${context.roots.profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--password-store=basic",
    "--use-mock-keychain",
    "--force-device-scale-factor=1",
    `--window-size=${BROWSER_VIEWPORT_WIDTH},${BROWSER_VIEWPORT_HEIGHT}`,
  ];
  if (proxyUrl) {
    args.push(
      `--proxy-server=${proxyUrl}`,
      "--proxy-bypass-list=<-loopback>",
    );
  }
  args.push("about:blank");
  if (args.includes("--no-sandbox") || args.some((argument) => argument.includes("docker.sock"))) {
    throw new ChromeRuntimeError("CHROME_ARGUMENTS_UNSAFE", "Unsafe Chrome launch arguments are forbidden.");
  }
  return Object.freeze(args);
}

async function resolveChromeExecutable(configured: string | undefined) {
  const explicit = configured?.trim() || process.env.AIBRAIN_CHROME_EXECUTABLE?.trim();
  if (process.env.NODE_ENV === "production" && !explicit) {
    throw new ChromeRuntimeError(
      "CHROME_EXECUTABLE_REQUIRED",
      "An explicit Chrome executable is required in production.",
    );
  }
  const candidates = explicit ? [explicit] : [
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
      : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium-browser" : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      const canonical = await realpath(candidate);
      const metadata = await lstat(canonical);
      if (!metadata.isFile()) continue;
      await access(canonical, constants.X_OK);
      return canonical;
    } catch {
      // Continue through the fixed local executable candidates.
    }
  }
  throw new ChromeRuntimeError("CHROME_EXECUTABLE_NOT_FOUND", "Chrome or Chromium executable was not found.");
}

export async function probeChromeRuntimeCapability(options: {
  executablePath?: string;
  expectedVersion?: string;
} = {}) {
  try {
    validateExpectedVersion(options.expectedVersion ?? process.env.AIBRAIN_CHROME_EXPECTED_VERSION);
    await resolveChromeExecutable(options.executablePath);
    return Object.freeze({ available: true as const, code: null });
  } catch (error) {
    return Object.freeze({
      available: false as const,
      code: error instanceof ChromeRuntimeError ? error.code : "CHROME_CAPABILITY_UNAVAILABLE",
    });
  }
}

function boundedErrorText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(-8_192);
}

function validateRuntimeContext(context: BrowserRuntimeContext) {
  if (!context || typeof context !== "object" || !path.isAbsolute(context.roots.browserRoot)) {
    throw new ChromeRuntimeError("CHROME_CONTEXT_INVALID", "Browser runtime context is invalid.");
  }
  if (context.roots.profile === context.roots.downloads) {
    throw new ChromeRuntimeError("CHROME_ROOT_INVALID", "Profile and downloads roots must be different.");
  }
}

function validateInput(command: BrowserInputCommand) {
  if (command.kind === "mouse") {
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y) ||
      command.x < 0 || command.y < 0 || command.x > 100_000 || command.y > 100_000) {
      throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Mouse coordinates are invalid.");
    }
    if (command.clickCount !== undefined &&
      (!Number.isSafeInteger(command.clickCount) || command.clickCount < 0 || command.clickCount > 3)) {
      throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Mouse click count is invalid.");
    }
    if (command.buttons !== undefined &&
      (!Number.isSafeInteger(command.buttons) || command.buttons < 0 || command.buttons > 7)) {
      throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Mouse buttons bitfield is invalid.");
    }
    for (const delta of [command.deltaX, command.deltaY]) {
      if (delta !== undefined && (!Number.isFinite(delta) || Math.abs(delta) > 100_000)) {
        throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Mouse wheel delta is invalid.");
      }
    }
    return;
  }
  if (!command.key || command.key.length > 64 || /[\u0000-\u001f\u007f]/u.test(command.key) ||
    (command.code !== undefined && (command.code.length > 64 || /[\u0000-\u001f\u007f]/u.test(command.code))) ||
    (command.text !== undefined && command.text.length > 4_096) ||
    (command.modifiers !== undefined &&
      (!Number.isSafeInteger(command.modifiers) || command.modifiers < 0 || command.modifiers > 15))) {
    throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Keyboard input is invalid.");
  }
}

function virtualKeyCode(key: string, code?: string) {
  const editing: Record<string, number> = {
    Backspace: 8, Tab: 9, Enter: 13, Escape: 27, " ": 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46,
  };
  if (Object.hasOwn(editing, key)) return editing[key];
  if (code && /^Key[A-Z]$/u.test(code)) return code.charCodeAt(3);
  if (code && /^Digit[0-9]$/u.test(code)) return code.charCodeAt(5);
  return /^[A-Za-z0-9]$/u.test(key) ? key.toUpperCase().charCodeAt(0) : 0;
}

function validateThreadId(threadId: string) {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new ChromeRuntimeError(
      "CHROME_THREAD_INVALID",
      "Browser threadId must be a canonical lowercase UUID.",
    );
  }
  return threadId;
}

function validateSelector(selector: string) {
  if (typeof selector !== "string" || selector.length < 1 ||
    Buffer.byteLength(selector, "utf8") > MAX_SELECTOR_BYTES || /[\u0000-\u001f\u007f]/u.test(selector)) {
    throw new ChromeRuntimeError("CHROME_SELECTOR_INVALID", "Browser selector is invalid.");
  }
  return selector;
}

function validateTypedText(text: string) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_TYPE_TEXT_BYTES || text.includes("\0")) {
    throw new ChromeRuntimeError("CHROME_TEXT_INVALID", "Browser input text is invalid.");
  }
  return text;
}

async function wait(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class ChromeCdpRuntime implements ApprovalBoundManagedBrowserRuntime {
  readonly context: BrowserRuntimeContext;
  readonly expectedVersion: string | undefined;
  readonly startupTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly maxThreadTargets: number;
  private readonly configuredExecutable: string | undefined;
  private readonly spawnProcess: NonNullable<RuntimeDependencies["spawnProcess"]>;
  private readonly connectCdpPipe: NonNullable<RuntimeDependencies["connectCdpPipe"]>;
  private readonly networkPolicy: BrowserNetworkPolicy;
  private readonly egressProxy: BrowserEgressProxy | null;
  private readonly navigationStore: BrowserNavigationStore;
  private readonly now: () => number;
  private process: ChromeProcess | null = null;
  private browserClient: CdpClientLike | null = null;
  private readonly threadPages = new Map<string, ThreadPage>();
  private readonly threadPagePromises = new Map<string, Promise<ThreadPage>>();
  private readonly pointerTrails = new Map<string, readonly BrowserPointerTrailPoint[]>();
  private pointerSequence = 0;
  private readonly downloadOwners = new Map<string, ThreadPage>();
  private readonly downloadFinalizations = new Set<Promise<void>>();
  private readonly navigationWrites = new Set<Promise<void>>();
  private readonly proxyAuthResponses = new Set<Promise<void>>();
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stderrTail = "";
  private running = false;
  private takenOver = false;
  private controlGeneration = 0;
  private browserVersion: string | null = null;
  private downloadQuarantine: string | null = null;
  private egressProxyUrl: string | null = null;
  private lastDownloadFailure: string | null = null;
  private lastNavigationFailure: string | null = null;
  private lastProxyAuthFailure: string | null = null;
  private detachedUnsubscribe: (() => void) | null = null;
  private targetCreatedUnsubscribe: (() => void) | null = null;
  private targetDestroyedUnsubscribe: (() => void) | null = null;
  private readonly discoveredTargets = new Map<string, {
    type: string;
    openerId: string | null;
    url: string | null;
  }>();
  private readonly pendingOwnedTargets = new Set<string>();
  private readonly closingTargetIds = new Set<string>();
  private readonly unownedTargetClosures = new Set<Promise<void>>();
  private targetCreations = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private activeOperations = 0;
  private queuedOperations = 0;

  private recordPointer(threadId: string, x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pointerSequence += 1;
    const point = Object.freeze({
      id: `${this.now()}-${this.pointerSequence}`,
      x: Math.max(0, Math.min(100, (x / BROWSER_VIEWPORT_WIDTH) * 100)),
      y: Math.max(0, Math.min(100, (y / BROWSER_VIEWPORT_HEIGHT) * 100)),
    });
    const current = this.pointerTrails.get(threadId) ?? [];
    this.pointerTrails.set(
      threadId,
      Object.freeze([...current, point].slice(-MAX_POINTER_TRAIL_POINTS)),
    );
  }

  constructor(context: BrowserRuntimeContext, options: ChromeCdpRuntimeOptions = {}) {
    validateRuntimeContext(context);
    if (options.allowPrivateNetwork) {
      new BrowserNetworkPolicy({ allowPrivateNetwork: true });
    }
    this.context = context;
    this.configuredExecutable = options.executablePath;
    this.expectedVersion = validateExpectedVersion(
      options.expectedVersion ?? process.env.AIBRAIN_CHROME_EXPECTED_VERSION,
    );
    this.startupTimeoutMs = positiveInteger("startupTimeoutMs", options.startupTimeoutMs ?? 20_000, 60_000);
    this.commandTimeoutMs = positiveInteger("commandTimeoutMs", options.commandTimeoutMs ?? 10_000, 60_000);
    this.shutdownTimeoutMs = positiveInteger("shutdownTimeoutMs", options.shutdownTimeoutMs ?? 3_000, 30_000);
    this.maxThreadTargets = positiveInteger("maxThreadTargets", options.maxThreadTargets ?? 32, 512);
    this.spawnProcess = options.spawnProcess ?? ((executable, args, spawnOptions) =>
      spawn(executable, [...args], spawnOptions) as ChromeProcess);
    this.connectCdpPipe = options.connectCdpPipe ?? ((requestPipe, responsePipe, clientOptions) =>
      PrivateCdpClient.connect(requestPipe, responsePipe, clientOptions));
    this.networkPolicy = options.networkPolicy ?? (() => {
      const lookup = options.allowPrivateNetwork ? undefined : browserDnsLookupFromEnvironment();
      return new BrowserNetworkPolicy({
        allowPrivateNetwork: options.allowPrivateNetwork,
        ...(lookup ? { lookup } : {}),
      });
    })();
    // The local-network override exists only for real, synthetic browser tests
    // and BrowserNetworkPolicy rejects it in production. All normal runtimes
    // share this exact policy with their per-user DNS-pinning egress proxy.
    this.egressProxy = options.allowPrivateNetwork
      ? null
      : new BrowserEgressProxy({ networkPolicy: this.networkPolicy });
    this.now = options.now ?? Date.now;
    this.navigationStore = new BrowserNavigationStore({
      browserRoot: context.roots.browserRoot,
      installationId: context.installationId,
      userId: context.userId,
      now: this.now,
    });
  }

  get targetId() {
    return this.threadPages.size === 1
      ? this.threadPages.values().next().value?.targetId ?? null
      : null;
  }

  targetIdFor(threadId: string) {
    validateThreadId(threadId);
    return this.threadPages.get(threadId)?.targetId ?? null;
  }

  async start() {
    if (this.running && this.process?.exitCode === null && this.browserClient?.isOpen) return;
    if (this.running) await this.stop();
    if (this.startPromise) return this.startPromise;
    const promise = this.startOnce();
    this.startPromise = promise;
    try {
      await promise;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  async health(): Promise<BrowserRuntimeHealth> {
    if (!this.running || !this.process || this.process.exitCode !== null || !this.browserClient?.isOpen) {
      return { healthy: false, detail: "Chrome process or private CDP connection is not running." };
    }
    try {
      if (this.egressProxy) {
        const proxy = await this.egressProxy.health();
        if (!proxy.healthy) {
          return { healthy: false, detail: `Chrome pinned egress proxy is unavailable: ${proxy.detail}` };
        }
      }
      if (this.lastDownloadFailure) {
        return { healthy: false, detail: `Chrome download routing failed: ${this.lastDownloadFailure}` };
      }
      if (this.lastNavigationFailure) {
        return { healthy: false, detail: `Chrome navigation persistence failed: ${this.lastNavigationFailure}` };
      }
      if (this.lastProxyAuthFailure) {
        return { healthy: false, detail: `Chrome loopback proxy authentication failed: ${this.lastProxyAuthFailure}` };
      }
      // Page navigation and frame capture share one inherited CDP pipe. A
      // status poll must not inject another command while that pipe is busy or
      // mistake normal page work for a dead browser and fence the live session.
      if (this.activeOperations > 0 || this.queuedOperations > 0) {
        return {
          healthy: true,
          detail: this.egressProxy
            ? `Chrome ${this.browserVersion} is processing a private browser operation with pinned loopback egress.`
            : `Chrome ${this.browserVersion} is processing a private browser operation.`,
        };
      }
      const version = await this.browserClient.send<{ product: string }>("Browser.getVersion");
      const current = extractBrowserVersion(version.product);
      if (current !== this.browserVersion) {
        return { healthy: false, detail: "Chrome version changed during the runtime session." };
      }
      return {
        healthy: true,
        detail: this.egressProxy
          ? `Chrome ${current} on a private inherited CDP pipe with pinned loopback egress.`
          : `Chrome ${current} on a private inherited CDP pipe with the development private-network override.`,
      };
    } catch {
      return { healthy: false, detail: "Chrome private CDP health check failed." };
    }
  }

  async captureFrame(threadId: string): Promise<BrowserFrame> {
    const result = await this.withThreadPageRecovery(threadId, (page) => this.captureScreenshot(page));
    if (typeof result.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(result.data)) {
      throw new ChromeRuntimeError("CHROME_SCREENSHOT_INVALID", "Chrome returned an invalid screenshot.");
    }
    const bytes = Buffer.from(result.data, "base64");
    if (bytes.byteLength < PNG_SIGNATURE.byteLength || bytes.byteLength > MAX_SCREENSHOT_BYTES ||
      !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
      throw new ChromeRuntimeError("CHROME_SCREENSHOT_INVALID", "Chrome screenshot is not a bounded PNG.");
    }
    return Object.freeze({
      schemaVersion: 1,
      mediaType: "image/png",
      dataBase64: result.data,
      capturedAt: new Date(this.now()).toISOString(),
      pointerTrail: this.pointerTrails.get(threadId) ?? Object.freeze([]),
    });
  }

  async agentCaptureFrame(threadId: string): Promise<BrowserFrame> {
    this.assertAgentControl();
    const frame = await this.captureFrame(threadId);
    this.assertAgentControl();
    return frame;
  }

  async navigate(threadId: string, url: string) {
    this.assertHumanControl();
    await this.navigatePage(threadId, url, () => this.assertHumanControl());
  }

  async viewerNavigationState(threadId: string): Promise<BrowserViewerNavigationState> {
    return this.withThreadPageRecovery(threadId, (page) => this.navigationStateForPage(page));
  }

  async navigateHistory(
    threadId: string,
    action: BrowserViewerHistoryAction,
  ): Promise<BrowserViewerNavigationState> {
    this.assertHumanControl();
    return this.withThreadPageRecovery(threadId, async (page) => {
      this.assertHumanControl();
      const browser = this.requireBrowser();
      if (action === "reload") {
        await browser.send("Page.reload", { ignoreCache: false }, { sessionId: page.sessionId });
        this.pointerTrails.delete(threadId);
      } else {
        const history = await this.navigationHistory(page);
        const targetIndex = history.currentIndex + (action === "back" ? -1 : 1);
        const target = history.entries[targetIndex];
        if (!target) return this.navigationStateFromHistory(history);
        const destination = validateBrowserNavigationUrl(target.url);
        await this.networkPolicy.assertAllowed(destination);
        this.assertHumanControl();
        await browser.send("Page.navigateToHistoryEntry", { entryId: target.id }, { sessionId: page.sessionId });
        this.pointerTrails.delete(threadId);
      }
      await this.waitForReadablePage(page, () => this.assertHumanControl());
      const current = await this.navigationStateForPage(page);
      await this.persistNavigation(page, current.url);
      return current;
    }, false);
  }

  async agentNavigate(threadId: string, url: string) {
    this.assertAgentControl();
    await this.navigatePage(threadId, url, () => this.assertAgentControl());
  }

  private async navigatePage(threadId: string, url: string, assertController: () => void) {
    const destination = validateBrowserNavigationUrl(url);
    await this.networkPolicy.assertAllowed(destination);
    let navigatedPage: ThreadPage | null = null;
    const result = await this.withThreadPageRecovery(threadId, async (page) => {
      assertController();
      const response = await this.requireBrowser().send<{ errorText?: string; isDownload?: boolean }>("Page.navigate", {
        url: destination,
      }, { sessionId: page.sessionId });
      if (!response.errorText && !response.isDownload) {
        await this.waitForReadablePage(page, assertController);
      }
      navigatedPage = page;
      return response;
    }, false);
    if (result.errorText && !result.isDownload) {
      throw new ChromeRuntimeError("CHROME_NAVIGATION_FAILED", boundedErrorText(result.errorText));
    }
    if (!result.isDownload && navigatedPage) {
      this.pointerTrails.delete(threadId);
      await this.persistNavigation(navigatedPage, destination);
    }
  }

  private async navigationHistory(page: ThreadPage) {
    const result = await this.requireBrowser().send<{
      currentIndex?: number;
      entries?: Array<{ id?: number; url?: string }>;
    }>("Page.getNavigationHistory", {}, { sessionId: page.sessionId });
    if (!Number.isSafeInteger(result.currentIndex) || !Array.isArray(result.entries) ||
      result.entries.length < 1 || result.entries.length > 10_000 ||
      (result.currentIndex as number) < 0 || (result.currentIndex as number) >= result.entries.length) {
      throw new ChromeRuntimeError("CHROME_PAGE_STATE_INVALID", "Chrome returned invalid navigation history.");
    }
    const entries = result.entries.map((entry) => {
      if (!Number.isSafeInteger(entry.id) || (entry.id as number) < 0 ||
        typeof entry.url !== "string" || entry.url.length > 8_192) {
        throw new ChromeRuntimeError("CHROME_PAGE_STATE_INVALID", "Chrome returned an invalid navigation entry.");
      }
      return { id: entry.id as number, url: validateBrowserNavigationUrl(entry.url) };
    });
    return { currentIndex: result.currentIndex as number, entries };
  }

  private navigationStateFromHistory(history: Awaited<ReturnType<ChromeCdpRuntime["navigationHistory"]>>) {
    const current = history.entries[history.currentIndex];
    if (!current) {
      throw new ChromeRuntimeError("CHROME_PAGE_STATE_INVALID", "Chrome did not report the current navigation entry.");
    }
    return Object.freeze({
      url: current.url,
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex + 1 < history.entries.length,
    });
  }

  private async navigationStateForPage(page: ThreadPage) {
    return this.navigationStateFromHistory(await this.navigationHistory(page));
  }

  async dispatchInput(threadId: string, command: BrowserInputCommand) {
    this.assertHumanControl();
    validateInput(command);
    const controlGeneration = this.controlGeneration;
    await this.withThreadPageRecovery(threadId, async (page) => {
      this.assertHumanControl();
      if (controlGeneration !== this.controlGeneration) {
        throw new ChromeRuntimeError("CHROME_INPUT_REJECTED", "Browser controller changed before input dispatch.");
      }
      const browser = this.requireBrowser();
      if (command.kind === "mouse") {
        // Record before dispatch: a lost response cannot prove the press failed.
        if ((command.event === "mousePressed" && command.button === "left") ||
          (command.event === "mouseMoved" && page.heldMouse)) {
          page.heldMouse = { x: command.x, y: command.y };
        }
        await browser.send("Input.dispatchMouseEvent", {
          type: command.event,
          x: command.x,
          y: command.y,
          button: command.button ?? "none",
          ...(command.buttons === undefined ? {} : { buttons: command.buttons }),
          clickCount: command.clickCount ?? 0,
          deltaX: command.deltaX ?? 0,
          deltaY: command.deltaY ?? 0,
        }, { sessionId: page.sessionId });
        if (command.event === "mouseReleased" && command.button === "left") {
          page.heldMouse = null;
          this.recordPointer(threadId, command.x, command.y);
        }
        return;
      }
      // Clipboard/IME text is not a single keyboard character. CDP rejects
      // multi-codepoint text on dispatchKeyEvent; insertText preserves it once.
      if (command.event === "char") {
        await browser.send("Input.insertText", { text: command.text ?? "" }, { sessionId: page.sessionId });
        return;
      }
      await browser.send("Input.dispatchKeyEvent", {
        type: command.event,
        key: command.key,
        code: command.code ?? "",
        text: command.text ?? "",
        modifiers: command.modifiers ?? 0,
        windowsVirtualKeyCode: virtualKeyCode(command.key, command.code),
      }, { sessionId: page.sessionId });
    }, false);
  }

  async readPage(threadId: string): Promise<BrowserPageSnapshot> {
    const marker = `aibrain-${threadId.replaceAll("-", "")}`;
    this.assertAgentControl();
    const evaluated = await this.withThreadPageRecovery(threadId, async (page) => {
      this.assertAgentControl();
      return this.requireBrowser().send<{
        result?: { value?: unknown };
        exceptionDetails?: unknown;
      }>("Runtime.evaluate", {
        expression: `(() => {
          const marker = ${JSON.stringify(marker)};
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          for (const previous of document.querySelectorAll("a[data-aibrain-link]")) previous.removeAttribute("data-aibrain-link");
          const candidates = [];
          for (const anchor of document.querySelectorAll("a[href]")) {
            if (candidates.length >= 400 || !visible(anchor)) continue;
            let destination;
            try { destination = new URL(anchor.href); } catch { continue; }
            if ((destination.protocol !== "http:" && destination.protocol !== "https:") ||
              destination.href.length > ${MAX_PAGE_LINK_HREF_CHARS}) continue;
            const text = (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || destination.href).trim();
            const priority = destination.pathname.includes("/noticias/") || anchor.closest("article")
              ? 0 : text.length >= 40 ? 1 : anchor.closest("main") ? 2 : 3;
            candidates.push({ anchor, destination, text, priority, order: candidates.length });
          }
          candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
          const links = [];
          for (const candidate of candidates.slice(0, ${MAX_PAGE_LINKS})) {
            const target = marker + "-" + links.length;
            candidate.anchor.setAttribute("data-aibrain-link", target);
            links.push({
              text: candidate.text.slice(0, ${MAX_PAGE_LINK_TEXT_CHARS}),
              href: candidate.destination.href,
              selector: 'a[data-aibrain-link="' + target + '"]',
            });
          }
          return {
            url: location.href,
            title: document.title,
            text: (document.body?.innerText ?? document.documentElement?.innerText ?? "").slice(0, ${MAX_PAGE_TEXT_CHARS}),
            links,
          };
        })()`,
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      }, { sessionId: page.sessionId });
    });
    if (evaluated.exceptionDetails || !evaluated.result ||
      !evaluated.result.value || typeof evaluated.result.value !== "object" ||
      Array.isArray(evaluated.result.value)) {
      throw new ChromeRuntimeError("CHROME_PAGE_READ_FAILED", "Chrome could not return a safe page snapshot.");
    }
    const value = evaluated.result.value as Record<string, unknown>;
    this.assertAgentControl();
    if (typeof value.url !== "string" || value.url.length > 8_192 ||
      typeof value.title !== "string" || value.title.length > 1_000 ||
      typeof value.text !== "string" || value.text.length > MAX_PAGE_TEXT_CHARS ||
      !Array.isArray(value.links) || value.links.length > MAX_PAGE_LINKS) {
      throw new ChromeRuntimeError("CHROME_PAGE_READ_FAILED", "Chrome returned an invalid page snapshot.");
    }
    const links = value.links.map((entry) => {
      if (!isRecord(entry) || typeof entry.text !== "string" || entry.text.length > MAX_PAGE_LINK_TEXT_CHARS ||
        typeof entry.href !== "string" || entry.href.length > MAX_PAGE_LINK_HREF_CHARS ||
        typeof entry.selector !== "string" || entry.selector.length > MAX_SELECTOR_BYTES ||
        !/^a\[data-aibrain-link="aibrain-[0-9a-f]{32}-\d{1,2}"\]$/u.test(entry.selector)) {
        throw new ChromeRuntimeError("CHROME_PAGE_READ_FAILED", "Chrome returned an invalid clickable link.");
      }
      validateBrowserNavigationUrl(entry.href);
      return Object.freeze({ text: entry.text, href: entry.href, selector: entry.selector });
    });
    return Object.freeze({
      schemaVersion: 1,
      url: value.url,
      title: value.title,
      text: value.text,
      links: Object.freeze(links),
    });
  }

  async listTabs(threadId: string) {
    const page = await this.readPage(threadId);
    return Object.freeze([Object.freeze({
      id: threadId,
      url: page.url,
      title: page.title,
      active: true as const,
    })]);
  }

  async listDownloads(threadId: string): Promise<readonly BrowserDownloadSnapshot[]> {
    this.assertAgentControl();
    validateThreadId(threadId);
    const downloadsPath = await this.ensureThreadDownloadsPath(threadId);
    const names = (await readdir(downloadsPath)).sort().slice(0, MAX_LISTED_DOWNLOADS);
    const downloads: BrowserDownloadSnapshot[] = [];
    for (const fileName of names) {
      if (fileName === "." || fileName === ".." || path.basename(fileName) !== fileName ||
        /[\\/\u0000-\u001f\u007f]/u.test(fileName)) continue;
      const metadata = await lstat(path.join(downloadsPath, fileName));
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        (metadata.mode & 0o022) !== 0) continue;
      downloads.push(Object.freeze({ fileName, sizeBytes: metadata.size }));
    }
    this.assertAgentControl();
    return Object.freeze(downloads);
  }

  async agentScroll(threadId: string, deltaX: number, deltaY: number) {
    this.assertAgentControl();
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) ||
      Math.abs(deltaX) > 5_000 || Math.abs(deltaY) > 5_000 || (deltaX === 0 && deltaY === 0)) {
      throw new ChromeRuntimeError("CHROME_SCROLL_INVALID", "Browser scroll delta is invalid.");
    }
    await this.withThreadPageRecovery(threadId, async (page) => {
      this.assertAgentControl();
      await this.scrollPage(page, deltaX, deltaY);
    });
  }

  async agentClick(threadId: string, selector: string) {
    this.assertAgentControl();
    const safeSelector = validateSelector(selector);
    await this.withThreadPageRecovery(threadId, async (page) => {
      this.assertAgentControl();
      const nodeId = await this.querySelector(page, safeSelector);
      await this.requireBrowser().send("DOM.scrollIntoViewIfNeeded", { nodeId }, { sessionId: page.sessionId });
      const result = await this.requireBrowser().send<{
        model?: { border?: number[] };
      }>("DOM.getBoxModel", { nodeId }, { sessionId: page.sessionId });
      const border = result.model?.border;
      if (!Array.isArray(border) || border.length !== 8 || !border.every(Number.isFinite)) {
        throw new ChromeRuntimeError("CHROME_ELEMENT_NOT_VISIBLE", "Browser element is not visible.");
      }
      const x = (border[0] + border[2] + border[4] + border[6]) / 4;
      const y = (border[1] + border[3] + border[5] + border[7]) / 4;
      this.assertAgentControl();
      const browser = this.requireBrowser();
      await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, { sessionId: page.sessionId });
      this.assertAgentControl();
      await browser.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1,
      }, { sessionId: page.sessionId });
      this.assertAgentControl();
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: 1,
      }, { sessionId: page.sessionId });
      this.recordPointer(threadId, x, y);
    });
  }

  async agentType(threadId: string, selector: string, text: string, clear: boolean) {
    this.assertAgentControl();
    const safeSelector = validateSelector(selector);
    validateTypedText(text);
    await this.withThreadPageRecovery(threadId, async (page) => {
      this.assertAgentControl();
      const nodeId = await this.querySelector(page, safeSelector);
      const browser = this.requireBrowser();
      await browser.send("DOM.focus", { nodeId }, { sessionId: page.sessionId });
      if (clear) {
        this.assertAgentControl();
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyDown", key: "a", code: "KeyA", modifiers: 2,
        }, { sessionId: page.sessionId });
        this.assertAgentControl();
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyUp", key: "a", code: "KeyA", modifiers: 2,
        }, { sessionId: page.sessionId });
        this.assertAgentControl();
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyDown", key: "Backspace", code: "Backspace",
        }, { sessionId: page.sessionId });
        this.assertAgentControl();
        await browser.send("Input.dispatchKeyEvent", {
          type: "keyUp", key: "Backspace", code: "Backspace",
        }, { sessionId: page.sessionId });
      }
      this.assertAgentControl();
      await browser.send("Input.insertText", { text }, { sessionId: page.sessionId });
    });
  }

  async prepareAgentMutation(
    threadId: string,
    command: BrowserMutationCommand,
  ): Promise<BrowserActionResourceSnapshot> {
    this.assertAgentControl();
    return this.withThreadPageRecovery(threadId, async (page) => {
      this.assertAgentControl();
      return this.actionResource(page, command);
    });
  }

  async executeAgentMutation(
    threadId: string,
    command: BrowserMutationCommand,
    expected: BrowserActionResourceSnapshot,
    evidenceFingerprint: string,
  ): Promise<BrowserActionReadback> {
    this.assertAgentControl();
    if (!/^[0-9a-f]{64}$/u.test(evidenceFingerprint)) {
      throw new ChromeRuntimeError("CHROME_ACTION_EVIDENCE_INVALID", "Browser action evidence is invalid.");
    }
    return this.withExclusiveBrowserOperation(async () => {
      const page = await this.requireThreadPage(threadId);
      this.assertAgentControl();
      const current = await this.actionResource(page, command);
      if (!sameBrowserActionResource(current, expected)) {
        throw new ChromeRuntimeError(
          "CHROME_ACTION_EVIDENCE_MISMATCH",
          "Browser page or target changed after approval; a new approval is required.",
        );
      }
      await this.dispatchApprovedAgentMutation(page, command);
      this.assertAgentControl();
      if (command.action === "type" && command.clear) {
        await this.verifyTypedValue(page, command.selector, command.text);
        return Object.freeze({
          schemaVersion: 1,
          outcome: "applied" as const,
          verification: "type-value-matched" as const,
          actionKind: command.action,
          evidenceFingerprint,
          resource: expected,
          observedAt: new Date(this.now()).toISOString(),
        });
      }
      return Object.freeze({
        schemaVersion: 1,
        outcome: "dispatched" as const,
        verification: "cdp-dispatch-acknowledged" as const,
        actionKind: command.action,
        evidenceFingerprint,
        resource: expected,
        observedAt: new Date(this.now()).toISOString(),
      });
    });
  }

  private async verifyTypedValue(page: ThreadPage, selector: string | undefined, text: string | undefined) {
    const safeSelector = validateSelector(selector ?? "");
    const expected = text ?? "";
    const evaluated = await this.requireBrowser().send<{
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(safeSelector)});
        if (!element) return { verifiable: false, matched: false };
        const expected = ${JSON.stringify(expected)};
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return { verifiable: true, matched: element.value === expected };
        }
        if (element instanceof HTMLElement && element.isContentEditable) {
          return { verifiable: true, matched: element.textContent === expected };
        }
        return { verifiable: false, matched: false };
      })()`,
      returnByValue: true,
      awaitPromise: false,
      userGesture: false,
    }, { sessionId: page.sessionId });
    if (evaluated.exceptionDetails || !isRecord(evaluated.result?.value) ||
      typeof evaluated.result.value.verifiable !== "boolean" ||
      typeof evaluated.result.value.matched !== "boolean") {
      throw new ChromeRuntimeError(
        "CHROME_ACTION_READBACK_UNAVAILABLE",
        "Browser action readback is unavailable after typing.",
      );
    }
    if (!evaluated.result.value.verifiable || !evaluated.result.value.matched) {
      throw new ChromeRuntimeError(
        "CHROME_ACTION_READBACK_MISMATCH",
        "Browser typed value could not be verified after dispatch.",
      );
    }
  }

  private async actionResource(
    page: ThreadPage,
    command: BrowserMutationCommand,
  ): Promise<BrowserActionResourceSnapshot> {
    validateThreadId(page.threadId);
    if (command.action === "open") {
      const destination = validateBrowserNavigationUrl(command.url ?? "");
      await this.networkPolicy.assertAllowed(destination);
      const parsed = destination === "about:blank" ? null : new URL(destination);
      const origin = parsed?.origin ?? "about:blank";
      const sanitizedUrl = parsed ? `${parsed.origin}${parsed.pathname}`.slice(0, 1_200) : "about:blank";
      return Object.freeze({
        kind: "browser-page",
        origin,
        sanitizedUrl,
        scopeId: page.threadId,
        generation: page.documentGeneration,
        version: page.documentVersion,
        locatorHash: browserEvidenceHash({ action: command.action, destination }),
        locatorSummary: `open ${sanitizedUrl}`,
      });
    }
    const selector = command.action === "click" || command.action === "type"
      ? validateSelector(command.selector ?? "") : null;
    let backendNodeId: number | null = null;
    if (selector) {
      const nodeId = await this.querySelector(page, selector);
      const described = await this.requireBrowser().send<{
        node?: { backendNodeId?: number };
      }>("DOM.describeNode", { nodeId }, { sessionId: page.sessionId });
      if (!Number.isSafeInteger(described.node?.backendNodeId) || (described.node?.backendNodeId ?? 0) < 1) {
        throw new ChromeRuntimeError("CHROME_ACTION_EVIDENCE_INVALID", "Chrome returned invalid target evidence.");
      }
      backendNodeId = described.node?.backendNodeId ?? null;
    }
    const evaluated = await this.requireBrowser().send<{
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression: `(() => {
        const selector = ${JSON.stringify(selector)};
        const element = selector ? document.querySelector(selector) : null;
        if (selector && !element) return { missing: true, url: location.href, title: document.title };
        const name = element
          ? (element.getAttribute('aria-label') || element.getAttribute('title') ||
            element.getAttribute('placeholder') || element.innerText || element.getAttribute('name') || '').trim()
          : '';
        return {
          missing: false,
          url: location.href,
          title: document.title,
          tag: element?.tagName?.toLowerCase() || '',
          role: element?.getAttribute('role') || '',
          name: name.slice(0, 240),
          href: element instanceof HTMLAnchorElement ? element.href : '',
          inputType: element instanceof HTMLInputElement ? element.type : '',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
      userGesture: false,
    }, { sessionId: page.sessionId });
    if (evaluated.exceptionDetails || !isRecord(evaluated.result?.value)) {
      throw new ChromeRuntimeError("CHROME_ACTION_EVIDENCE_UNAVAILABLE", "Browser action evidence is unavailable.");
    }
    const value = evaluated.result.value;
    if (value.missing) {
      throw new ChromeRuntimeError("CHROME_ELEMENT_NOT_FOUND", "Browser selector did not match an element.");
    }
    if (typeof value.url !== "string" || typeof value.title !== "string" ||
      typeof value.tag !== "string" || typeof value.role !== "string" ||
      typeof value.name !== "string" || typeof value.href !== "string" ||
      typeof value.inputType !== "string") {
      throw new ChromeRuntimeError("CHROME_ACTION_EVIDENCE_INVALID", "Chrome returned invalid action evidence.");
    }
    const safeUrl = validateBrowserNavigationUrl(value.url);
    const parsed = safeUrl === "about:blank" ? null : new URL(safeUrl);
    const sanitizedUrl = parsed ? `${parsed.origin}${parsed.pathname}`.slice(0, 1_200) : "about:blank";
    const locator = {
      selector,
      tag: value.tag.slice(0, 64),
      role: value.role.slice(0, 128),
      name: value.name.slice(0, 240),
      hrefHash: value.href ? browserEvidenceHash(value.href) : null,
      inputType: value.inputType.slice(0, 64),
      backendNodeId,
    };
    return Object.freeze({
      kind: "browser-page",
      origin: parsed?.origin ?? "about:blank",
      sanitizedUrl,
      scopeId: page.threadId,
      generation: page.documentGeneration,
      version: page.documentVersion,
      locatorHash: browserEvidenceHash(locator),
      locatorSummary: selector
        ? `${selector.slice(0, 300)} · ${locator.tag || "element"}${locator.role ? ` role=${locator.role}` : ""}${locator.name ? ` · ${locator.name}` : ""}`
        : `${command.action} ${sanitizedUrl}`,
    });
  }

  private async dispatchApprovedAgentMutation(page: ThreadPage, command: BrowserMutationCommand) {
    const browser = this.requireBrowser();
    if (command.action === "open") {
      const destination = validateBrowserNavigationUrl(command.url ?? "");
      const response = await browser.send<{ errorText?: string; isDownload?: boolean }>("Page.navigate", {
        url: destination,
      }, { sessionId: page.sessionId });
      if (response.errorText && !response.isDownload) {
        throw new ChromeRuntimeError("CHROME_NAVIGATION_FAILED", boundedErrorText(response.errorText));
      }
      if (!response.isDownload) {
        this.pointerTrails.delete(page.threadId);
        await this.waitForReadablePage(page, () => this.assertAgentControl());
        await this.persistNavigation(page, destination);
      }
      return;
    }
    if (command.action === "scroll") {
      const deltaX = command.deltaX ?? Number.NaN;
      const deltaY = command.deltaY ?? Number.NaN;
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) ||
        Math.abs(deltaX) > 5_000 || Math.abs(deltaY) > 5_000 || (deltaX === 0 && deltaY === 0)) {
        throw new ChromeRuntimeError("CHROME_SCROLL_INVALID", "Browser scroll delta is invalid.");
      }
      await this.scrollPage(page, deltaX, deltaY);
      return;
    }
    const selector = validateSelector(command.selector ?? "");
    const nodeId = await this.querySelector(page, selector);
    if (command.action === "click") {
      await browser.send("DOM.scrollIntoViewIfNeeded", { nodeId }, { sessionId: page.sessionId });
      const result = await browser.send<{ model?: { border?: number[] } }>("DOM.getBoxModel", {
        nodeId,
      }, { sessionId: page.sessionId });
      const border = result.model?.border;
      if (!Array.isArray(border) || border.length !== 8 || !border.every(Number.isFinite)) {
        throw new ChromeRuntimeError("CHROME_ELEMENT_NOT_VISIBLE", "Browser element is not visible.");
      }
      const x = (border[0] + border[2] + border[4] + border[6]) / 4;
      const y = (border[1] + border[3] + border[5] + border[7]) / 4;
      await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, { sessionId: page.sessionId });
      await browser.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1,
      }, { sessionId: page.sessionId });
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: 1,
      }, { sessionId: page.sessionId });
      this.recordPointer(page.threadId, x, y);
      return;
    }
    const text = command.text ?? "";
    validateTypedText(text);
    await browser.send("DOM.focus", { nodeId }, { sessionId: page.sessionId });
    if (command.clear) {
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: "a", code: "KeyA", modifiers: 2,
      }, { sessionId: page.sessionId });
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "a", code: "KeyA", modifiers: 2,
      }, { sessionId: page.sessionId });
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Backspace", code: "Backspace",
      }, { sessionId: page.sessionId });
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Backspace", code: "Backspace",
      }, { sessionId: page.sessionId });
    }
    await browser.send("Input.insertText", { text }, { sessionId: page.sessionId });
  }

  private async querySelector(page: ThreadPage, selector: string) {
    const browser = this.requireBrowser();
    const document = await browser.send<{ root?: { nodeId?: number } }>("DOM.getDocument", {
      depth: 0,
      pierce: false,
    }, { sessionId: page.sessionId });
    const rootNodeId = document.root?.nodeId;
    if (!Number.isSafeInteger(rootNodeId) || (rootNodeId as number) < 1) {
      throw new ChromeRuntimeError("CHROME_DOCUMENT_INVALID", "Chrome document root is unavailable.");
    }
    const found = await browser.send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: rootNodeId,
      selector,
    }, { sessionId: page.sessionId });
    if (!Number.isSafeInteger(found.nodeId) || (found.nodeId as number) < 1) {
      throw new ChromeRuntimeError("CHROME_ELEMENT_NOT_FOUND", "Browser selector did not match an element.");
    }
    return found.nodeId as number;
  }

  private async scrollPage(page: ThreadPage, deltaX: number, deltaY: number) {
    const evaluated = await this.requireBrowser().send<{ exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression: `window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: "instant" })`,
      returnByValue: true,
      awaitPromise: false,
      userGesture: true,
    }, { sessionId: page.sessionId });
    if (evaluated.exceptionDetails) {
      throw new ChromeRuntimeError("CHROME_SCROLL_FAILED", "Browser page rejected the scroll operation.");
    }
  }

  async takeOver() {
    if (!this.running) throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome runtime is not running.");
    this.controlGeneration += 1;
    this.takenOver = false;
    await this.withExclusiveBrowserOperation(async () => {
      await this.resetHeldMouse();
      this.takenOver = true;
    });
  }

  async releaseTakeover() {
    this.controlGeneration += 1;
    this.takenOver = false;
    await this.withExclusiveBrowserOperation(() => this.resetHeldMouse());
  }

  private async resetHeldMouse() {
    for (const page of this.threadPages.values()) {
      if (!page.heldMouse || page.closed) continue;
      // This controller boundary shares the input lane. No successor is active
      // until the owned page's possibly-held button has been acknowledged up.
      await this.requireBrowser().send("Input.dispatchMouseEvent", {
        type: "mouseReleased", ...page.heldMouse, button: "left", buttons: 0, clickCount: 1,
      }, { sessionId: page.sessionId });
      page.heldMouse = null;
    }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    const promise = this.stopOnce();
    this.stopPromise = promise;
    try {
      await promise;
    } finally {
      if (this.stopPromise === promise) this.stopPromise = null;
    }
  }

  async currentUrl(threadId?: string) {
    const browser = this.requireBrowser();
    const page = threadId === undefined
      ? this.singleThreadPage()
      : await this.requireThreadPage(threadId);
    const result = await browser.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    }>("Target.getTargets");
    const current = result.targetInfos?.find((target) => target.targetId === page.targetId);
    if (!current || current.type !== "page" || typeof current.url !== "string") {
      throw new ChromeRuntimeError("CHROME_PAGE_STATE_INVALID", "Chrome did not report the current page URL.");
    }
    return current.url;
  }

  private async startOnce() {
    await this.assertRoots();
    const executable = await resolveChromeExecutable(this.configuredExecutable);
    this.downloadQuarantine = await ensurePrivateSubdirectory(
      this.context.roots.browserRoot,
      "download-quarantine",
    );
    await this.cleanupDownloadQuarantine();
    const runtimeTmp = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "runtime-tmp");
    const xdgConfig = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "xdg/config");
    const xdgCache = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "xdg/cache");
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV,
      HOME: this.context.roots.browserRoot,
      TMPDIR: runtimeTmp,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_CACHE_HOME: xdgCache,
      LANG: process.env.LANG ?? "C.UTF-8",
      LC_ALL: process.env.LC_ALL,
      TZ: process.env.TZ ?? "UTC",
    };
    try {
      const proxyUrl = this.egressProxy ? await this.egressProxy.start() : null;
      this.egressProxyUrl = proxyUrl;
      const args = buildChromeArguments(this.context, proxyUrl);
      const version = await this.launchPipeWithBackoff(executable, args, environment);
      if (this.expectedVersion && version !== this.expectedVersion) {
        throw new ChromeRuntimeError(
          "CHROME_VERSION_MISMATCH",
          `Chrome version ${version} does not match the required version.`,
        );
      }
      this.browserVersion = version;
      const browser = this.browserClient as CdpClientLike;
      this.detachedUnsubscribe = browser.on("Target.detachedFromTarget", (params) => {
        this.handleDetachedTarget(params);
      });
      this.targetCreatedUnsubscribe = browser.on("Target.targetCreated", (params) => {
        this.handleTargetCreated(params);
      });
      this.targetDestroyedUnsubscribe = browser.on("Target.targetDestroyed", (params) => {
        this.handleTargetDestroyed(params);
      });
      await browser.send("Target.setDiscoverTargets", { discover: true });
      // Page.setDownloadBehavior delegates to this same browser-context policy in
      // Chromium. Use GUID names in a private quarantine and route completed files
      // from target-scoped Page events instead of racing a path between threads.
      await browser.send("Browser.setDownloadBehavior", {
        behavior: "allowAndName",
        downloadPath: this.downloadQuarantine,
        eventsEnabled: true,
      });
      this.running = true;
      this.takenOver = false;
    } catch (error) {
      await this.stopOnce().catch(() => undefined);
      throw error;
    }
  }

  private async assertRoots() {
    const rootMetadata = await lstat(this.context.roots.browserRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new ChromeRuntimeError("CHROME_ROOT_UNSAFE", "browserRoot must be a real directory.");
    }
    await chmod(this.context.roots.browserRoot, 0o700);
    await Promise.all([
      assertPrivateDirectory(this.context.roots.browserRoot, this.context.roots.profile, "profile root"),
      assertPrivateDirectory(this.context.roots.browserRoot, this.context.roots.downloads, "downloads root"),
    ]);
  }

  private async launchPipeWithBackoff(
    executable: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ) {
    const deadline = this.now() + this.startupTimeoutMs;
    let attempt = 0;
    let lastError: unknown;
    while (this.now() < deadline) {
      this.stderrTail = "";
      let spawnFailure: Error | null = null;
      const child = this.spawnProcess(executable, args, {
        cwd: this.context.roots.browserRoot,
        env: environment,
        detached: false,
        shell: false,
        stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      });
      this.process = child;
      child.once("error", (error) => {
        spawnFailure = error instanceof Error ? error : new Error("Chrome spawn failed.");
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        this.stderrTail = boundedErrorText(`${this.stderrTail}${chunk.toString()}`);
      });
      let client: CdpClientLike | null = null;
      try {
        const { requestPipe, responsePipe } = this.pipeStreams(child);
        const remaining = Math.max(1, deadline - this.now());
        client = this.connectCdpPipe(requestPipe, responsePipe, {
          commandTimeoutMs: Math.min(this.commandTimeoutMs, remaining),
        });
        this.browserClient = client;
        const cdpVersion = await client.send<{ product: string }>("Browser.getVersion");
        return extractBrowserVersion(cdpVersion.product);
      } catch (error) {
        lastError = spawnFailure ?? error;
        this.browserClient = null;
        if (client) await client.close().catch(() => undefined);
        await this.stopFailedLaunch(child);
        this.process = null;
        if (this.now() >= deadline) break;
        await wait(Math.min(25 * (2 ** attempt), 500));
        attempt += 1;
      }
    }
    throw new ChromeRuntimeError(
      "CHROME_START_TIMEOUT",
      `Chrome private CDP pipe did not become ready. ${this.stderrTail}`.trim(),
      { cause: lastError },
    );
  }

  private pipeStreams(child: ChromeProcess) {
    const requestPipe = child.stdio[3];
    const responsePipe = child.stdio[4];
    if (!requestPipe || typeof (requestPipe as Writable).write !== "function" ||
      typeof (requestPipe as Writable).destroy !== "function" ||
      !responsePipe || typeof (responsePipe as Readable).on !== "function" ||
      typeof (responsePipe as Readable).destroy !== "function") {
      throw new ChromeRuntimeError(
        "CHROME_CDP_PIPE_UNAVAILABLE",
        "Chrome did not expose its inherited CDP request and response pipes.",
      );
    }
    return {
      requestPipe: requestPipe as Writable,
      responsePipe: responsePipe as Readable,
    };
  }

  private async stopFailedLaunch(child: ChromeProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!await this.waitForExit(child, Math.min(this.shutdownTimeoutMs, 500))) {
      child.kill("SIGKILL");
      await this.waitForExit(child, Math.min(this.shutdownTimeoutMs, 500));
    }
  }

  private async requireThreadPage(threadId: string) {
    validateThreadId(threadId);
    if (!this.running || this.process?.exitCode !== null) {
      throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome page is not available.");
    }
    const current = this.threadPages.get(threadId);
    if (current && !current.closed && this.browserClient?.isOpen) return current;
    if (current) {
      this.threadPages.delete(threadId);
      this.pointerTrails.delete(threadId);
      await this.closeThreadPage(current);
    }
    const pending = this.threadPagePromises.get(threadId);
    if (pending) return pending;
    if (this.threadPages.size + this.threadPagePromises.size >= this.maxThreadTargets) {
      throw new ChromeRuntimeError(
        "CHROME_TARGET_BACKPRESSURE",
        "Browser target capacity is saturated; close an inactive thread target and retry.",
      );
    }
    const promise = this.createThreadPage(threadId);
    this.threadPagePromises.set(threadId, promise);
    try {
      return await promise;
    } finally {
      if (this.threadPagePromises.get(threadId) === promise) {
        this.threadPagePromises.delete(threadId);
      }
    }
  }

  private async withThreadPageRecovery<Result>(
    threadId: string,
    operation: (page: ThreadPage) => Promise<Result>,
    replayOnStale = true,
  ): Promise<Result> {
    return this.withExclusiveBrowserOperation(async () => {
      const page = await this.requireThreadPage(threadId);
      try {
        return await operation(page);
      } catch (error) {
        // Input/navigation may already have affected the page before the stale
        // response (including a subsequent readback). Never dispatch it twice.
        if (!replayOnStale) throw error;
        if (!isRecoverableThreadSessionError(error)) throw error;
        if (this.threadPages.get(threadId) === page) {
          this.threadPages.delete(threadId);
          this.pointerTrails.delete(threadId);
          await this.closeThreadPage(page);
        }
        const replacement = await this.requireThreadPage(threadId);
        return operation(replacement);
      }
    });
  }

  private async withExclusiveBrowserOperation<Result>(operation: () => Promise<Result>) {
    if (this.queuedOperations >= MAX_QUEUED_BROWSER_OPERATIONS) {
      throw new ChromeRuntimeError(
        "CHROME_OPERATION_BACKPRESSURE",
        "Browser operation capacity is saturated; retry with backoff.",
      );
    }
    const previous = this.operationTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.operationTail = previous.catch(() => undefined).then(() => gate);
    this.queuedOperations += 1;
    await previous.catch(() => undefined);
    this.queuedOperations -= 1;
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      release();
    }
  }

  private async captureScreenshot(page: ThreadPage) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.requireBrowser().send<{ data: string }>("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        }, { sessionId: page.sessionId });
      } catch (error) {
        if (!(error instanceof CdpClientError) || error.code !== "CDP_COMMAND_FAILED") throw error;
        lastError = error;
        if (isRecoverableThreadSessionError(error) || attempt === 2) throw error;
        await wait(250 * (attempt + 1));
      }
    }
    throw lastError;
  }

  private async waitForReadablePage(page: ThreadPage, assertController: () => void) {
    assertController();
    // Wait in the owned document, not by repeatedly reading all its text and
    // links. Blank pages, forms and canvas applications are valid documents.
    const evaluated = await this.requireBrowser().send<{
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression: `new Promise((resolve) => {
        if (document.readyState !== "loading") {
          resolve({ readyState: document.readyState });
          return;
        }
        let timer;
        const finish = () => {
          clearTimeout(timer);
          document.removeEventListener("DOMContentLoaded", finish);
          resolve({ readyState: document.readyState });
        };
        document.addEventListener("DOMContentLoaded", finish, { once: true });
        timer = setTimeout(finish, 4000);
      })`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    }, { sessionId: page.sessionId });
    assertController();
    const value = evaluated.result?.value;
    if (evaluated.exceptionDetails || !isRecord(value) ||
      (value.readyState !== "interactive" && value.readyState !== "complete")) {
      throw new ChromeRuntimeError("CHROME_DOCUMENT_NOT_READY", "Browser document did not become readable.");
    }
  }

  private singleThreadPage() {
    if (this.threadPages.size !== 1) {
      throw new ChromeRuntimeError(
        "CHROME_THREAD_REQUIRED",
        "A threadId is required unless exactly one browser thread target exists.",
      );
    }
    return this.threadPages.values().next().value as ThreadPage;
  }

  private async createThreadPage(threadId: string) {
    const browser = this.requireBrowser();
    this.targetCreations += 1;
    let targetId: string | null = null;
    let sessionId: string | null = null;
    let page: ThreadPage | null = null;
    try {
      const restoredUrl = validateBrowserNavigationUrl(
        await this.navigationStore.get(threadId) ?? "about:blank",
      );
      if (restoredUrl !== "about:blank") await this.networkPolicy.assertAllowed(restoredUrl);
      const created = await browser.send<{ targetId?: string }>("Target.createTarget", {
        url: "about:blank",
      });
      if (typeof created.targetId !== "string" ||
        !/^[A-Za-z0-9._-]{1,256}$/u.test(created.targetId)) {
        throw new ChromeRuntimeError("CHROME_TARGETS_INVALID", "Chrome returned an invalid page target ID.");
      }
      targetId = created.targetId;
      this.pendingOwnedTargets.add(targetId);
      const downloadsPath = await this.ensureThreadDownloadsPath(threadId);
      const attached = await browser.send<{ sessionId?: string }>("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      if (typeof attached.sessionId !== "string" ||
        !/^[A-Za-z0-9._-]{1,256}$/u.test(attached.sessionId)) {
        throw new ChromeRuntimeError("CHROME_SESSION_INVALID", "Chrome returned an invalid target session ID.");
      }
      sessionId = attached.sessionId;
      page = {
        threadId,
        targetId,
        sessionId,
        downloadsPath,
        heldMouse: null,
        downloads: new Map(),
        fetchUnsubscribe: null,
        authUnsubscribe: null,
        navigationUnsubscribe: null,
        downloadUnsubscribes: [],
        interceptedRequests: 0,
        documentGeneration: 1,
        documentVersion: browserEvidenceHash({ targetId, sessionId, restoredUrl, generation: 1 }),
        closed: false,
      };
      await browser.send("Page.enable", {}, { sessionId });
      await browser.send("Network.enable", {
        maxTotalBufferSize: 1_048_576,
        maxResourceBufferSize: 262_144,
      }, { sessionId });
      page.fetchUnsubscribe = browser.on("Fetch.requestPaused", (params) => {
        this.queueInterceptedRequest(page as ThreadPage, params);
      }, { sessionId });
      if (this.egressProxy) {
        page.authUnsubscribe = browser.on("Fetch.authRequired", (params) => {
          this.queueProxyAuthentication(page as ThreadPage, params);
        }, { sessionId });
      }
      page.navigationUnsubscribe = browser.on("Page.frameNavigated", (params) => {
        this.queueNavigationPersistence(page as ThreadPage, params);
      }, { sessionId });
      page.downloadUnsubscribes.push(
        browser.on("Page.downloadWillBegin", (params) => {
          this.registerDownload(page as ThreadPage, params);
        }, { sessionId }),
        browser.on("Page.downloadProgress", (params) => {
          this.updateDownload(page as ThreadPage, params);
        }, { sessionId }),
      );
      await browser.send("Fetch.enable", {
        handleAuthRequests: Boolean(this.egressProxy),
        patterns: [
          { urlPattern: "http://*", requestStage: "Request" },
          { urlPattern: "https://*", requestStage: "Request" },
        ],
      }, { sessionId });
      if (restoredUrl !== "about:blank") {
        const restored = await browser.send<{ errorText?: string; isDownload?: boolean }>("Page.navigate", {
          url: restoredUrl,
        }, { sessionId });
        if (restored.errorText || restored.isDownload) {
          throw new ChromeRuntimeError(
            "CHROME_NAVIGATION_RECOVERY_FAILED",
            boundedErrorText(restored.errorText ?? "Stored browser navigation became a download."),
          );
        }
      }
      if (!this.running) {
        throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome stopped while creating a thread target.");
      }
      this.threadPages.set(threadId, page);
      return page;
    } catch (error) {
      page?.fetchUnsubscribe?.();
      page?.authUnsubscribe?.();
      page?.navigationUnsubscribe?.();
      for (const unsubscribe of page?.downloadUnsubscribes ?? []) unsubscribe();
      if (browser.isOpen) {
        if (sessionId) {
          await browser.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
        }
        if (targetId) await browser.send("Target.closeTarget", { targetId }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (targetId) this.pendingOwnedTargets.delete(targetId);
      this.targetCreations -= 1;
      await this.reconcileUnownedTargets();
    }
  }

  private requireBrowser() {
    if (!this.running || !this.browserClient?.isOpen || this.process?.exitCode !== null) {
      throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome browser connection is not available.");
    }
    return this.browserClient;
  }

  private async ensureThreadDownloadsPath(threadId: string) {
    const candidate = path.join(this.context.roots.downloads, threadId);
    try {
      await mkdir(candidate, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertPrivateDirectory(this.context.roots.browserRoot, candidate, "thread downloads root");
    const [downloadsRoot, canonicalCandidate] = await Promise.all([
      realpath(this.context.roots.downloads),
      realpath(candidate),
    ]);
    if (!inside(downloadsRoot, canonicalCandidate)) {
      throw new ChromeRuntimeError(
        "CHROME_ROOT_ESCAPE",
        "Thread downloads root resolves outside the user downloads root.",
      );
    }
    return candidate;
  }

  private assertHumanControl() {
    if (!this.takenOver) {
      throw new ChromeRuntimeError("CHROME_TAKEOVER_REQUIRED", "Browser mutation requires active takeover.");
    }
  }

  private assertAgentControl() {
    if (this.takenOver) {
      throw new ChromeRuntimeError(
        "CHROME_HUMAN_CONTROL_ACTIVE",
        "Browser mutation is blocked during human takeover.",
      );
    }
  }

  private async persistNavigation(page: ThreadPage, url: string) {
    if (page.closed) return;
    try {
      await this.navigationStore.set(page.threadId, url);
      if (!page.closed) this.lastNavigationFailure = null;
    } catch (error) {
      this.lastNavigationFailure = boundedErrorText(
        error instanceof Error ? error.message : "Unknown navigation persistence failure.",
      );
      throw error;
    }
  }

  private queueNavigationPersistence(page: ThreadPage, value: unknown) {
    if (page.closed || !isRecord(value) || !isRecord(value.frame)) return;
    const frame = value.frame;
    if (frame.parentId !== undefined || typeof frame.url !== "string") return;
    let url: string;
    try {
      url = validateBrowserNavigationUrl(frame.url);
    } catch {
      return;
    }
    page.documentGeneration += 1;
    page.documentVersion = browserEvidenceHash({
      targetId: page.targetId,
      sessionId: page.sessionId,
      loaderId: typeof frame.loaderId === "string" ? frame.loaderId : null,
      url,
      generation: page.documentGeneration,
    });
    const write = this.persistNavigation(page, url);
    this.navigationWrites.add(write);
    void write.finally(() => this.navigationWrites.delete(write)).catch(() => undefined);
  }

  private handleDetachedTarget(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const detachedSessionId = (value as Record<string, unknown>).sessionId;
    if (typeof detachedSessionId !== "string") return;
    const page = [...this.threadPages.values()].find((candidate) =>
      candidate.sessionId === detachedSessionId);
    if (!page) return;
    page.closed = true;
    if (this.threadPages.get(page.threadId) === page) this.threadPages.delete(page.threadId);
    this.pointerTrails.delete(page.threadId);
    page.fetchUnsubscribe?.();
    page.fetchUnsubscribe = null;
    page.authUnsubscribe?.();
    page.authUnsubscribe = null;
    page.navigationUnsubscribe?.();
    page.navigationUnsubscribe = null;
    for (const unsubscribe of page.downloadUnsubscribes.splice(0)) unsubscribe();
    const guids = [...page.downloads.keys()];
    page.downloads.clear();
    for (const guid of guids) this.downloadOwners.delete(guid);
    const browser = this.browserClient;
    if (browser?.isOpen) {
      void browser.send("Target.closeTarget", { targetId: page.targetId }).catch(() => undefined);
    }
    void Promise.allSettled(guids.map((guid) => this.removeQuarantinedDownload(guid)));
  }

  private handleTargetCreated(value: unknown) {
    if (!isRecord(value) || !isRecord(value.targetInfo)) return;
    const info = value.targetInfo;
    if (typeof info.targetId !== "string" || !/^[A-Za-z0-9._-]{1,256}$/u.test(info.targetId) ||
        typeof info.type !== "string" || info.type.length > 64) return;
    // Worker, service-worker and Chromium's internal `tab` targets are not
    // independent visible pages. Closing them as if they were popups can tear
    // down the page target that owns the current navigation. Track only pages;
    // the application still exposes exclusively its thread-owned target.
    if (info.type !== "page") return;
    const openerId = typeof info.openerId === "string" ? info.openerId : null;
    const url = typeof info.url === "string" && info.url.length <= 8_192 ? info.url : null;
    this.discoveredTargets.set(info.targetId, { type: info.type, openerId, url });
    if (openerId && this.targetCreations === 0) {
      this.queueUnownedTargetClosure(info.targetId);
    }
  }

  private handleTargetDestroyed(value: unknown) {
    if (!isRecord(value) || typeof value.targetId !== "string") return;
    this.discoveredTargets.delete(value.targetId);
    this.pendingOwnedTargets.delete(value.targetId);
  }

  private ownsTarget(targetId: string) {
    return this.pendingOwnedTargets.has(targetId) ||
      [...this.threadPages.values()].some((page) => page.targetId === targetId && !page.closed);
  }

  private queueUnownedTargetClosure(targetId: string) {
    if (this.ownsTarget(targetId) || this.closingTargetIds.has(targetId)) return;
    this.closingTargetIds.add(targetId);
    const pending = Promise.resolve().then(async () => {
      if (this.ownsTarget(targetId)) return;
      const browser = this.browserClient;
      if (browser?.isOpen) {
        await browser.send("Target.closeTarget", { targetId }).catch(() => undefined);
      }
      this.discoveredTargets.delete(targetId);
    });
    this.unownedTargetClosures.add(pending);
    void pending.finally(() => {
      this.closingTargetIds.delete(targetId);
      this.unownedTargetClosures.delete(pending);
    }).catch(() => undefined);
  }

  private async reconcileUnownedTargets() {
    if (this.targetCreations > 0) return;
    for (const [targetId, target] of this.discoveredTargets) {
      if (!this.ownsTarget(targetId) && (target.openerId || target.url === "about:blank")) {
        this.queueUnownedTargetClosure(targetId);
      }
    }
    await Promise.allSettled([...this.unownedTargetClosures]);
  }

  private queueProxyAuthentication(page: ThreadPage, value: unknown) {
    if (page.closed || !this.browserClient?.isOpen) return;
    const response = this.handleProxyAuthentication(page, value);
    this.proxyAuthResponses.add(response);
    void response.finally(() => this.proxyAuthResponses.delete(response)).catch((error: unknown) => {
      this.lastProxyAuthFailure = boundedErrorText(
        error instanceof Error ? error.message : "Unknown loopback proxy authentication failure.",
      );
    });
  }

  private async handleProxyAuthentication(page: ThreadPage, value: unknown) {
    if (!isRecord(value) || typeof value.requestId !== "string" ||
      !/^[A-Za-z0-9.-]{1,256}$/u.test(value.requestId) || !isRecord(value.authChallenge)) {
      throw new ChromeRuntimeError("CHROME_PROXY_AUTH_INVALID", "Chrome proxy auth challenge is invalid.");
    }
    const challenge = value.authChallenge;
    let provide = false;
    if (challenge.source === "Proxy" && challenge.scheme === "basic" &&
      challenge.realm === "aibrain-browser" && typeof challenge.origin === "string" && this.egressProxyUrl) {
      try {
        provide = new URL(challenge.origin).origin === this.egressProxyUrl;
      } catch {
        provide = false;
      }
    }
    const credentials = this.egressProxy?.clientCredentials();
    await this.requireBrowser().send("Fetch.continueWithAuth", {
      requestId: value.requestId,
      authChallengeResponse: provide && credentials
        ? {
            response: "ProvideCredentials",
            username: credentials.username,
            password: credentials.password,
          }
        : { response: "CancelAuth" },
    }, { sessionId: page.sessionId });
    if (provide) this.lastProxyAuthFailure = null;
  }

  private queueInterceptedRequest(page: ThreadPage, value: unknown) {
    const browser = this.browserClient;
    if (page.closed || !browser?.isOpen) return;
    const requestId = this.interceptedRequestId(value);
    if (requestId === null) return;
    if (page.interceptedRequests >= MAX_INTERCEPTED_REQUESTS) {
      void browser.send("Fetch.failRequest", {
        requestId,
        errorReason: "BlockedByClient",
      }, { sessionId: page.sessionId }).catch(() => undefined);
      return;
    }
    page.interceptedRequests += 1;
    void this.handleInterceptedRequest(page, requestId, value).finally(() => {
      page.interceptedRequests -= 1;
    });
  }

  private interceptedRequestId(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const requestId = (value as Record<string, unknown>).requestId;
    return typeof requestId === "string" && /^[A-Za-z0-9.-]{1,256}$/u.test(requestId)
      ? requestId
      : null;
  }

  private async handleInterceptedRequest(page: ThreadPage, requestId: string, value: unknown) {
    let allowed = false;
    try {
      const request = (value as Record<string, unknown>).request;
      if (request && typeof request === "object" && !Array.isArray(request)) {
        const url = (request as Record<string, unknown>).url;
        if (typeof url === "string") {
          await this.networkPolicy.assertAllowed(url);
          allowed = true;
        }
      }
    } catch {
      allowed = false;
    }
    const browser = this.browserClient;
    if (page.closed || !browser?.isOpen) return;
    await browser.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
      ? { requestId }
      : { requestId, errorReason: "BlockedByClient" }, { sessionId: page.sessionId })
      .catch(() => undefined);
  }

  private registerDownload(page: ThreadPage, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const guid = record.guid;
    if (typeof guid !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(guid)) return;
    const fileName = this.safeDownloadFileName(record.suggestedFilename, guid);
    const existing = this.downloadOwners.get(guid);
    if (existing && existing !== page) {
      const tracked = existing.downloads.get(guid);
      existing.downloads.delete(guid);
      this.downloadOwners.delete(guid);
      const cleanup = Promise.all([
        this.removeQuarantinedDownload(guid),
        tracked ? this.finishDownloadProjection(tracked.projectionId, { status: "failed" }) : Promise.resolve(),
      ]).then(() => undefined);
      this.trackDownloadFinalization(cleanup);
      return;
    }
    const projectionId = this.context.downloadProjection
      ? this.context.downloadProjection.start(fileName)
        .then((download) => download.id)
        .catch((error: unknown) => {
          this.lastDownloadFailure = boundedErrorText(
            error instanceof Error ? error.message : "Browser download projection failed.",
          );
          return null;
        })
      : Promise.resolve(null);
    page.downloads.set(guid, Object.freeze({ fileName, projectionId }));
    this.downloadOwners.set(guid, page);
  }

  private updateDownload(page: ThreadPage, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const guid = record.guid;
    if (typeof guid !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(guid) ||
      this.downloadOwners.get(guid) !== page) return;
    const state = record.state;
    if (state !== "completed" && state !== "canceled") return;
    const tracked = page.downloads.get(guid);
    page.downloads.delete(guid);
    this.downloadOwners.delete(guid);
    const finalization = (async () => {
      if (state === "completed" && tracked) {
        const sizeBytes = await this.promoteQuarantinedDownload(page, guid, tracked.fileName);
        await this.finishDownloadProjection(tracked.projectionId, { status: "complete", sizeBytes });
        return;
      }
      await this.removeQuarantinedDownload(guid);
      if (tracked) await this.finishDownloadProjection(tracked.projectionId, { status: "failed" });
    })();
    this.trackDownloadFinalization(finalization);
  }

  private trackDownloadFinalization(finalization: Promise<void>) {
    this.downloadFinalizations.add(finalization);
    void finalization.finally(() => this.downloadFinalizations.delete(finalization))
      .catch((error: unknown) => {
        this.lastDownloadFailure = boundedErrorText(
          error instanceof Error ? error.message : "Unknown download routing failure.",
        );
      });
  }

  private async finishDownloadProjection(
    projectionId: Promise<string | null>,
    result: { status: "complete"; sizeBytes: number } | { status: "failed" },
  ) {
    const downloadId = await projectionId;
    if (downloadId && this.context.downloadProjection) {
      await this.context.downloadProjection.finish(downloadId, result);
    }
  }

  private safeDownloadFileName(value: unknown, guid: string) {
    if (typeof value !== "string") return `download-${guid}`;
    const normalized = value.normalize("NFC");
    if (normalized === "." || normalized === ".." || normalized.length < 1 ||
      Buffer.byteLength(normalized, "utf8") > 180 || path.basename(normalized) !== normalized ||
      /[\\/\u0000-\u001f\u007f]/u.test(normalized)) {
      return `download-${guid}`;
    }
    return normalized;
  }

  private async promoteQuarantinedDownload(page: ThreadPage, guid: string, fileName: string) {
    const quarantine = this.downloadQuarantine;
    if (!quarantine) {
      throw new ChromeRuntimeError("CHROME_DOWNLOAD_INVALID", "Chrome download quarantine is unavailable.");
    }
    const source = path.join(quarantine, guid);
    let metadata: Awaited<ReturnType<typeof lstat>> | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        metadata = await lstat(source);
        break;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
      await wait(25);
    }
    const wrongOwner = metadata && typeof process.getuid === "function" && metadata.uid !== process.getuid();
    if (!metadata || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      wrongOwner || (metadata.mode & 0o022) !== 0) {
      await unlink(source).catch(() => undefined);
      throw new ChromeRuntimeError(
        "CHROME_DOWNLOAD_INVALID",
        "Completed Chrome download is not a private regular quarantine file.",
      );
    }
    await assertPrivateDirectory(this.context.roots.browserRoot, page.downloadsPath, "thread downloads root");
    const parsed = path.parse(fileName);
    const alternatives = [
      fileName,
      `${parsed.name}-${guid.slice(0, 16)}${parsed.ext}`,
    ];
    for (const candidate of alternatives) {
      const destination = path.join(page.downloadsPath, candidate);
      try {
        await link(source, destination);
        await chmod(destination, 0o600);
        await unlink(source);
        return metadata.size;
      } catch (error) {
        if (isNodeError(error, "EEXIST")) continue;
        throw error;
      }
    }
    await unlink(source).catch(() => undefined);
    throw new ChromeRuntimeError(
      "CHROME_DOWNLOAD_CONFLICT",
      "Thread download destination already exists.",
    );
  }

  private async removeQuarantinedDownload(guid: string) {
    if (!this.downloadQuarantine) return;
    const candidate = path.join(this.downloadQuarantine, guid);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
    const wrongOwner = typeof process.getuid === "function" && metadata.uid !== process.getuid();
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      wrongOwner || (metadata.mode & 0o022) !== 0) {
      throw new ChromeRuntimeError(
        "CHROME_DOWNLOAD_QUARANTINE_UNSAFE",
        "Chrome download quarantine entry is not a private regular file.",
      );
    }
    await unlink(candidate);
  }

  private async cleanupDownloadQuarantine() {
    const quarantine = this.downloadQuarantine;
    if (!quarantine) return;
    const entries = await readdir(quarantine);
    if (entries.length > MAX_QUARANTINE_ENTRIES) {
      throw new ChromeRuntimeError(
        "CHROME_DOWNLOAD_QUARANTINE_UNSAFE",
        "Chrome download quarantine contains too many stale entries.",
      );
    }
    for (const entry of entries) {
      if (entry.length < 1 || Buffer.byteLength(entry, "utf8") > 255 ||
        entry === "." || entry === ".." || /[\\/\u0000-\u001f\u007f]/u.test(entry)) {
        throw new ChromeRuntimeError(
          "CHROME_DOWNLOAD_QUARANTINE_UNSAFE",
          "Chrome download quarantine contains an invalid entry name.",
        );
      }
      const candidate = path.join(quarantine, entry);
      const metadata = await lstat(candidate);
      const wrongOwner = typeof process.getuid === "function" && metadata.uid !== process.getuid();
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        wrongOwner || (metadata.mode & 0o022) !== 0) {
        throw new ChromeRuntimeError(
          "CHROME_DOWNLOAD_QUARANTINE_UNSAFE",
          "Chrome download quarantine contains a non-private or non-regular entry.",
        );
      }
      await unlink(candidate);
    }
  }

  private async stopOnce() {
    try {
      await this.stopBrowserOnce();
    } finally {
      await this.egressProxy?.stop();
    }
  }

  private async stopBrowserOnce() {
    this.running = false;
    this.takenOver = false;
    const browser = this.browserClient;
    const child = this.process;
    await Promise.allSettled([...this.threadPagePromises.values()]);
    await Promise.allSettled([...this.downloadFinalizations]);
    await Promise.allSettled([...this.navigationWrites]);
    await Promise.allSettled([...this.proxyAuthResponses]);
    await Promise.allSettled([...this.unownedTargetClosures]);
    const pages = [...this.threadPages.values()];
    const activeDownloadGuids = pages.flatMap((page) => [...page.downloads.keys()]);
    this.threadPages.clear();
    this.threadPagePromises.clear();
    this.pointerTrails.clear();
    this.downloadOwners.clear();
    this.detachedUnsubscribe?.();
    this.detachedUnsubscribe = null;
    this.targetCreatedUnsubscribe?.();
    this.targetCreatedUnsubscribe = null;
    this.targetDestroyedUnsubscribe?.();
    this.targetDestroyedUnsubscribe = null;
    this.discoveredTargets.clear();
    this.pendingOwnedTargets.clear();
    this.closingTargetIds.clear();
    this.targetCreations = 0;
    this.browserClient = null;
    if (browser?.isOpen) {
      await browser.send("Target.setDiscoverTargets", { discover: false }).catch(() => undefined);
      await browser.send("Browser.setDownloadBehavior", {
        behavior: "deny",
        eventsEnabled: false,
      }).catch(() => undefined);
    }
    await Promise.allSettled(pages.map((page) => this.closeThreadPage(page, browser)));
    await Promise.allSettled([...this.downloadFinalizations]);
    await Promise.allSettled([...this.navigationWrites]);
    await Promise.allSettled([...this.proxyAuthResponses]);
    if (browser?.isOpen) await browser.send("Browser.close").catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    if (child && child.exitCode === null) {
      if (!await this.waitForExit(child, this.shutdownTimeoutMs)) {
        child.kill("SIGTERM");
        if (!await this.waitForExit(child, this.shutdownTimeoutMs)) {
          child.kill("SIGKILL");
          await this.waitForExit(child, this.shutdownTimeoutMs);
        }
      }
    }
    await Promise.allSettled(activeDownloadGuids.map((guid) => this.removeQuarantinedDownload(guid)));
    this.process = null;
    this.downloadQuarantine = null;
    this.egressProxyUrl = null;
    this.lastDownloadFailure = null;
    this.lastNavigationFailure = null;
    this.lastProxyAuthFailure = null;
    this.browserVersion = null;
  }

  private async closeThreadPage(page: ThreadPage, browser = this.browserClient) {
    page.closed = true;
    page.fetchUnsubscribe?.();
    page.fetchUnsubscribe = null;
    page.authUnsubscribe?.();
    page.authUnsubscribe = null;
    page.navigationUnsubscribe?.();
    page.navigationUnsubscribe = null;
    for (const unsubscribe of page.downloadUnsubscribes.splice(0)) unsubscribe();
    const activeDownloads = [...page.downloads.entries()];
    if (browser?.isOpen) {
      await browser.send("Fetch.disable", {}, { sessionId: page.sessionId }).catch(() => undefined);
      await browser.send("Target.detachFromTarget", { sessionId: page.sessionId }).catch(() => undefined);
      await browser.send("Target.closeTarget", { targetId: page.targetId }).catch(() => undefined);
    }
    await Promise.all(activeDownloads.map(async ([guid, tracked]) => {
      this.downloadOwners.delete(guid);
      await this.removeQuarantinedDownload(guid);
      await this.finishDownloadProjection(tracked.projectionId, { status: "failed" });
    }));
    page.downloads.clear();
  }

  private async waitForExit(child: ChromeProcess, timeoutMs: number) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

export class ChromeBrowserRuntimeFactory implements BrowserRuntimeFactory {
  private readonly options: ChromeBrowserRuntimeFactoryOptions;

  constructor(options: ChromeBrowserRuntimeFactoryOptions = {}) {
    validateExpectedVersion(options.expectedVersion ?? process.env.AIBRAIN_CHROME_EXPECTED_VERSION);
    if (options.allowPrivateNetwork) {
      new BrowserNetworkPolicy({ allowPrivateNetwork: true });
    }
    this.options = { ...options };
  }

  create(context: BrowserRuntimeContext) {
    return new ChromeCdpRuntime(context, this.options);
  }
}
