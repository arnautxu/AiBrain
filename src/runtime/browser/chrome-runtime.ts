import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, realpath, unlink } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";
import type {
  BrowserFrame,
  BrowserInputCommand,
  BrowserRuntimeContext,
  BrowserRuntimeFactory,
  BrowserRuntimeHealth,
  InteractiveManagedBrowserRuntime,
} from "@/runtime/browser/types";
import {
  normalizePrivateDevToolsWebSocket,
  PrivateCdpClient,
  type PrivateCdpClientOptions,
  type PrivateCdpMethod,
} from "@/runtime/browser/cdp-client";
import { readRegularFileWithin, UnsafeFilePathError } from "@/security/safe-file";

const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/u;
const DEVTOOLS_PATH_PATTERN = /^\/devtools\/browser\/[A-Za-z0-9._-]{1,256}$/u;
const PAGE_PATH_PATTERN = /^\/devtools\/page\/[A-Za-z0-9._-]{1,256}$/u;
const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

export type CdpClientLike = {
  readonly isOpen: boolean;
  send<Result = unknown>(method: PrivateCdpMethod, params?: Record<string, unknown>): Promise<Result>;
  close(): Promise<void>;
};

type RuntimeDependencies = {
  spawnProcess?: (executable: string, args: readonly string[], options: SpawnOptions) => ChromeProcess;
  fetchJson?: (port: number, resource: "/json/version" | "/json/list", timeoutMs: number) => Promise<unknown>;
  connectCdp?: (endpoint: string, options: PrivateCdpClientOptions) => Promise<CdpClientLike>;
  now?: () => number;
};

export type ChromeCdpRuntimeOptions = RuntimeDependencies & {
  executablePath?: string;
  expectedVersion?: string;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  shutdownTimeoutMs?: number;
};

export type ChromeBrowserRuntimeFactoryOptions = Pick<
  ChromeCdpRuntimeOptions,
  "executablePath" | "expectedVersion" | "startupTimeoutMs"
>;

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
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

export function parseDevToolsActivePort(contents: string) {
  if (Buffer.byteLength(contents, "utf8") > 1_024 || /\u0000/u.test(contents)) {
    throw new ChromeRuntimeError("CHROME_DEVTOOLS_MARKER_INVALID", "DevToolsActivePort is invalid.");
  }
  const lines = contents.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 2 || !/^\d{1,5}$/u.test(lines[0]) || !DEVTOOLS_PATH_PATTERN.test(lines[1])) {
    throw new ChromeRuntimeError("CHROME_DEVTOOLS_MARKER_INVALID", "DevToolsActivePort has an invalid shape.");
  }
  const port = Number(lines[0]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ChromeRuntimeError("CHROME_DEVTOOLS_MARKER_INVALID", "DevToolsActivePort contains an invalid port.");
  }
  return Object.freeze({ port, webSocketPath: lines[1] });
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

export function buildChromeArguments(context: BrowserRuntimeContext) {
  const args = [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${context.roots.profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--password-store=basic",
    "--use-mock-keychain",
    "--window-size=1440,900",
    "about:blank",
  ];
  if (args.includes("--no-sandbox") || args.some((argument) => argument.includes("docker.sock"))) {
    throw new ChromeRuntimeError("CHROME_ARGUMENTS_UNSAFE", "Unsafe Chrome launch arguments are forbidden.");
  }
  return Object.freeze(args);
}

async function defaultFetchJson(
  port: number,
  resource: "/json/version" | "/json/list",
  timeoutMs: number,
) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ChromeRuntimeError("CHROME_CDP_PORT_INVALID", "Chrome CDP port is invalid.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${resource}`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new ChromeRuntimeError("CHROME_CDP_HTTP_FAILED", "Chrome CDP discovery failed.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_HTTP_JSON_BYTES) {
      throw new ChromeRuntimeError("CHROME_CDP_HTTP_TOO_LARGE", "Chrome CDP discovery response is too large.");
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ChromeRuntimeError) throw error;
    throw new ChromeRuntimeError("CHROME_CDP_HTTP_FAILED", "Chrome CDP discovery failed.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveChromeExecutable(configured: string | undefined) {
  const candidates = [
    configured?.trim(),
    process.env.AIBRAIN_CHROME_EXECUTABLE?.trim(),
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

async function wait(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class ChromeCdpRuntime implements InteractiveManagedBrowserRuntime {
  readonly context: BrowserRuntimeContext;
  readonly expectedVersion: string | undefined;
  readonly startupTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  private readonly configuredExecutable: string | undefined;
  private readonly spawnProcess: NonNullable<RuntimeDependencies["spawnProcess"]>;
  private readonly fetchJson: NonNullable<RuntimeDependencies["fetchJson"]>;
  private readonly connectCdp: NonNullable<RuntimeDependencies["connectCdp"]>;
  private readonly now: () => number;
  private process: ChromeProcess | null = null;
  private browserClient: CdpClientLike | null = null;
  private pageClient: CdpClientLike | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private spawnFailure: Error | null = null;
  private stderrTail = "";
  private running = false;
  private takenOver = false;
  private browserVersion: string | null = null;
  private port: number | null = null;
  private pageTargetId: string | null = null;

  constructor(context: BrowserRuntimeContext, options: ChromeCdpRuntimeOptions = {}) {
    validateRuntimeContext(context);
    this.context = context;
    this.configuredExecutable = options.executablePath;
    this.expectedVersion = validateExpectedVersion(
      options.expectedVersion ?? process.env.AIBRAIN_CHROME_EXPECTED_VERSION,
    );
    this.startupTimeoutMs = positiveInteger("startupTimeoutMs", options.startupTimeoutMs ?? 20_000, 60_000);
    this.commandTimeoutMs = positiveInteger("commandTimeoutMs", options.commandTimeoutMs ?? 10_000, 60_000);
    this.shutdownTimeoutMs = positiveInteger("shutdownTimeoutMs", options.shutdownTimeoutMs ?? 3_000, 30_000);
    this.spawnProcess = options.spawnProcess ?? ((executable, args, spawnOptions) =>
      spawn(executable, [...args], spawnOptions));
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.connectCdp = options.connectCdp ?? ((endpoint, clientOptions) =>
      PrivateCdpClient.connect(endpoint, clientOptions));
    this.now = options.now ?? Date.now;
  }

  get debuggingPort() {
    return this.port;
  }

  get targetId() {
    return this.pageTargetId;
  }

  async start() {
    if (this.running) return;
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
      const version = await this.browserClient.send<{ product: string }>("Browser.getVersion");
      const current = extractBrowserVersion(version.product);
      if (current !== this.browserVersion) {
        return { healthy: false, detail: "Chrome version changed during the runtime session." };
      }
      return { healthy: true, detail: `Chrome ${current} on private loopback CDP.` };
    } catch {
      return { healthy: false, detail: "Chrome private CDP health check failed." };
    }
  }

  async captureFrame(): Promise<BrowserFrame> {
    const page = this.requirePage();
    const result = await page.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
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
    });
  }

  async navigate(url: string) {
    this.assertHumanControl();
    const result = await this.requirePage().send<{ errorText?: string; isDownload?: boolean }>("Page.navigate", {
      url: validateBrowserNavigationUrl(url),
    });
    if (result.errorText && !result.isDownload) {
      throw new ChromeRuntimeError("CHROME_NAVIGATION_FAILED", boundedErrorText(result.errorText));
    }
  }

  async dispatchInput(command: BrowserInputCommand) {
    this.assertHumanControl();
    validateInput(command);
    if (command.kind === "mouse") {
      await this.requirePage().send("Input.dispatchMouseEvent", {
        type: command.event,
        x: command.x,
        y: command.y,
        button: command.button ?? "none",
        clickCount: command.clickCount ?? 0,
        deltaX: command.deltaX ?? 0,
        deltaY: command.deltaY ?? 0,
      });
      return;
    }
    await this.requirePage().send("Input.dispatchKeyEvent", {
      type: command.event,
      key: command.key,
      code: command.code ?? "",
      text: command.text ?? "",
      modifiers: command.modifiers ?? 0,
    });
  }

  async takeOver() {
    if (!this.running) throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome runtime is not running.");
    this.takenOver = true;
  }

  async releaseTakeover() {
    this.takenOver = false;
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

  async currentUrl() {
    const browser = this.requireBrowser();
    const result = await browser.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    }>("Target.getTargets");
    const current = result.targetInfos?.find((target) => target.targetId === this.pageTargetId);
    if (!current || current.type !== "page" || typeof current.url !== "string") {
      throw new ChromeRuntimeError("CHROME_PAGE_STATE_INVALID", "Chrome did not report the current page URL.");
    }
    return current.url;
  }

  private async startOnce() {
    await this.assertRoots();
    const executable = await resolveChromeExecutable(this.configuredExecutable);
    await this.removeStaleMarker();
    const runtimeTmp = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "runtime-tmp");
    const xdgConfig = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "xdg/config");
    const xdgCache = await ensurePrivateSubdirectory(this.context.roots.browserRoot, "xdg/cache");
    const args = buildChromeArguments(this.context);
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
    this.process = this.spawnProcess(executable, args, {
      cwd: this.context.roots.browserRoot,
      env: environment,
      detached: false,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.spawnFailure = null;
    this.process.once("error", (error) => {
      this.spawnFailure = error instanceof Error ? error : new Error("Chrome spawn failed.");
    });
    this.process.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrTail = boundedErrorText(`${this.stderrTail}${chunk.toString()}`);
    });
    try {
      const marker = await this.waitForDevToolsMarker();
      this.port = marker.port;
      const versionDocument = await this.fetchJson(marker.port, "/json/version", this.commandTimeoutMs);
      const versionRecord = this.parseVersionDocument(versionDocument, marker.port, marker.webSocketPath);
      this.browserClient = await this.connectCdp(versionRecord.webSocketUrl, {
        commandTimeoutMs: this.commandTimeoutMs,
      });
      const cdpVersion = await this.browserClient.send<{ product: string }>("Browser.getVersion");
      const version = extractBrowserVersion(cdpVersion.product);
      if (version !== versionRecord.version || (this.expectedVersion && version !== this.expectedVersion)) {
        throw new ChromeRuntimeError(
          "CHROME_VERSION_MISMATCH",
          `Chrome version ${version} does not match the required version.`,
        );
      }
      this.browserVersion = version;
      await this.browserClient.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: this.context.roots.downloads,
        eventsEnabled: true,
      });
      const page = await this.resolvePage(marker.port);
      this.pageTargetId = page.id;
      this.pageClient = await this.connectCdp(page.webSocketUrl, {
        commandTimeoutMs: this.commandTimeoutMs,
      });
      await this.pageClient.send("Page.enable");
      await this.pageClient.send("Network.enable", {
        maxTotalBufferSize: 1_048_576,
        maxResourceBufferSize: 262_144,
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

  private async removeStaleMarker() {
    const markerPath = path.join(this.context.roots.profile, "DevToolsActivePort");
    try {
      const contents = await this.readDevToolsMarker();
      const marker = parseDevToolsActivePort(contents);
      try {
        const active = this.parseVersionDocument(
          await this.fetchJson(marker.port, "/json/version", 500),
          marker.port,
          marker.webSocketPath,
          false,
        );
        await this.closeOrphanBrowser(marker.port, active.webSocketUrl);
      } catch (error) {
        if (error instanceof ChromeRuntimeError && error.code === "CHROME_ORPHAN_CLOSE_FAILED") throw error;
        if (error instanceof ChromeRuntimeError && error.code !== "CHROME_CDP_HTTP_FAILED") throw error;
      }
      await unlink(markerPath).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
  }

  private async closeOrphanBrowser(port: number, webSocketUrl: string) {
    let client: CdpClientLike;
    try {
      client = await this.connectCdp(webSocketUrl, {
        commandTimeoutMs: Math.min(this.commandTimeoutMs, this.shutdownTimeoutMs),
      });
    } catch (error) {
      throw new ChromeRuntimeError(
        "CHROME_ORPHAN_CLOSE_FAILED",
        "The existing private Chrome endpoint could not be authenticated for recovery.",
        { cause: error },
      );
    }
    try {
      await client.send("Browser.close").catch(() => undefined);
    } finally {
      await client.close().catch(() => undefined);
    }

    const deadline = this.now() + this.shutdownTimeoutMs;
    while (this.now() < deadline) {
      try {
        await this.fetchJson(port, "/json/version", Math.min(250, this.shutdownTimeoutMs));
      } catch {
        return;
      }
      await wait(25);
    }
    throw new ChromeRuntimeError(
      "CHROME_ORPHAN_CLOSE_FAILED",
      "Existing Chrome did not release the private profile after Browser.close.",
    );
  }

  private async waitForDevToolsMarker() {
    const deadline = this.now() + this.startupTimeoutMs;
    while (this.now() < deadline) {
      if (this.spawnFailure) {
        throw new ChromeRuntimeError("CHROME_SPAWN_FAILED", "Chrome process could not start.", { cause: this.spawnFailure });
      }
      if (this.process?.exitCode !== null) {
        throw new ChromeRuntimeError(
          "CHROME_EXITED_DURING_START",
          `Chrome exited before CDP was ready. ${this.stderrTail}`.trim(),
        );
      }
      try {
        return parseDevToolsActivePort(await this.readDevToolsMarker());
      } catch (error) {
        const transientMarker = error instanceof UnsafeFilePathError ||
          (error instanceof ChromeRuntimeError && error.code === "CHROME_DEVTOOLS_MARKER_INVALID");
        if (!isNodeError(error, "ENOENT") && !transientMarker) throw error;
      }
      await wait(25);
    }
    throw new ChromeRuntimeError(
      "CHROME_START_TIMEOUT",
      `Chrome did not publish DevToolsActivePort in time. ${this.stderrTail}`.trim(),
    );
  }

  private async readDevToolsMarker() {
    const markerPath = path.join(this.context.roots.profile, "DevToolsActivePort");
    const metadata = await lstat(markerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      metadata.size > 1_024 || (metadata.mode & 0o022) !== 0) {
      throw new ChromeRuntimeError(
        "CHROME_DEVTOOLS_MARKER_INVALID",
        "DevToolsActivePort must be a private regular file.",
      );
    }
    return (await readRegularFileWithin(
      this.context.roots.profile,
      "DevToolsActivePort",
      1_024,
    )).toString("utf8");
  }

  private parseVersionDocument(
    value: unknown,
    port: number,
    expectedPath: string,
    enforceExpectedVersion = true,
  ) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ChromeRuntimeError("CHROME_CDP_DISCOVERY_INVALID", "Chrome version document is invalid.");
    }
    const record = value as Record<string, unknown>;
    const version = extractBrowserVersion(record.Browser);
    if (typeof record.webSocketDebuggerUrl !== "string") {
      throw new ChromeRuntimeError("CHROME_CDP_DISCOVERY_INVALID", "Chrome version document lacks its WebSocket URL.");
    }
    const webSocketUrl = normalizePrivateDevToolsWebSocket(record.webSocketDebuggerUrl, port);
    if (new URL(webSocketUrl).pathname !== expectedPath) {
      throw new ChromeRuntimeError("CHROME_CDP_DISCOVERY_INVALID", "Chrome CDP marker and endpoint do not match.");
    }
    if (enforceExpectedVersion && this.expectedVersion && version !== this.expectedVersion) {
      throw new ChromeRuntimeError(
        "CHROME_VERSION_MISMATCH",
        `Chrome version ${version} does not match required ${this.expectedVersion}.`,
      );
    }
    return { version, webSocketUrl };
  }

  private async resolvePage(port: number) {
    const value = await this.fetchJson(port, "/json/list", this.commandTimeoutMs);
    if (!Array.isArray(value) || value.length > 100) {
      throw new ChromeRuntimeError("CHROME_TARGETS_INVALID", "Chrome target list is invalid.");
    }
    const page = value.find((target) => target && typeof target === "object" &&
      (target as Record<string, unknown>).type === "page") as Record<string, unknown> | undefined;
    if (!page || typeof page.id !== "string" || page.id.length > 256 ||
      typeof page.webSocketDebuggerUrl !== "string") {
      throw new ChromeRuntimeError("CHROME_PAGE_NOT_FOUND", "Chrome did not expose a page target.");
    }
    const webSocketUrl = normalizePrivateDevToolsWebSocket(page.webSocketDebuggerUrl, port);
    if (!PAGE_PATH_PATTERN.test(new URL(webSocketUrl).pathname)) {
      throw new ChromeRuntimeError("CHROME_TARGETS_INVALID", "Chrome page target endpoint is invalid.");
    }
    return { id: page.id, webSocketUrl };
  }

  private requirePage() {
    if (!this.running || !this.pageClient?.isOpen || this.process?.exitCode !== null) {
      throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome page is not available.");
    }
    return this.pageClient;
  }

  private requireBrowser() {
    if (!this.running || !this.browserClient?.isOpen || this.process?.exitCode !== null) {
      throw new ChromeRuntimeError("CHROME_NOT_RUNNING", "Chrome browser connection is not available.");
    }
    return this.browserClient;
  }

  private assertHumanControl() {
    if (!this.takenOver) {
      throw new ChromeRuntimeError("CHROME_TAKEOVER_REQUIRED", "Browser mutation requires active takeover.");
    }
  }

  private async stopOnce() {
    this.running = false;
    this.takenOver = false;
    const browser = this.browserClient;
    const page = this.pageClient;
    const child = this.process;
    this.browserClient = null;
    this.pageClient = null;
    if (browser?.isOpen) await browser.send("Browser.close").catch(() => undefined);
    await Promise.allSettled([page?.close(), browser?.close()].filter(Boolean) as Promise<void>[]);
    if (child && child.exitCode === null) {
      if (!await this.waitForExit(child, this.shutdownTimeoutMs)) {
        child.kill("SIGTERM");
        if (!await this.waitForExit(child, this.shutdownTimeoutMs)) {
          child.kill("SIGKILL");
          await this.waitForExit(child, this.shutdownTimeoutMs);
        }
      }
    }
    this.process = null;
    this.port = null;
    this.pageTargetId = null;
    this.browserVersion = null;
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
    this.options = { ...options };
  }

  create(context: BrowserRuntimeContext) {
    return new ChromeCdpRuntime(context, this.options);
  }
}
