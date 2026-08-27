import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserRuntimeContext } from "@/runtime/browser/types";
import {
  buildChromeArguments,
  ChromeBrowserRuntimeFactory,
  ChromeCdpRuntime,
  ChromeRuntimeError,
  parseDevToolsActivePort,
  validateBrowserNavigationUrl,
  type CdpClientLike,
} from "@/runtime/browser/chrome-runtime";

const roots: string[] = [];

class FakeChromeProcess extends EventEmitter {
  readonly pid = 42_001;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    this.signalCode = signal;
    this.emit("exit", null, signal);
    return true;
  }

  exit() {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

class FakeCdpClient implements CdpClientLike {
  isOpen = true;
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(
    private readonly kind: "browser" | "page",
    private readonly onBrowserClose: () => void,
  ) {}

  async send<Result = unknown>(method: string, params: Record<string, unknown> = {}) {
    this.commands.push({ method, params });
    if (method === "Browser.getVersion") return { product: "HeadlessChrome/140.0.0.0" } as Result;
    if (method === "Browser.close") {
      this.onBrowserClose();
      return {} as Result;
    }
    if (method === "Page.captureScreenshot") {
      return { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64") } as Result;
    }
    if (method === "Target.getTargets") {
      return {
        targetInfos: [{ targetId: "page-1", type: "page", url: "https://example.test/" }],
      } as Result;
    }
    if (this.kind === "page" || this.kind === "browser") return {} as Result;
    throw new Error("unexpected client");
  }

  async close() {
    this.isOpen = false;
  }
}

async function contextFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-chrome-runtime-"));
  roots.push(root);
  const browserRoot = path.join(root, "browser");
  const profile = path.join(browserRoot, "profile");
  const downloads = path.join(browserRoot, "downloads");
  await Promise.all([
    mkdir(profile, { recursive: true, mode: 0o700 }),
    mkdir(downloads, { recursive: true, mode: 0o700 }),
  ]);
  const context: BrowserRuntimeContext = {
    installationId: "chrome-lab",
    userId: "0198b9f0-6631-7000-8000-000000000401",
    browserSessionId: "0198b9f0-6631-7000-8000-000000000402",
    generation: 1,
    recovering: false,
    roots: {
      browserRoot,
      profile,
      downloads,
      stateFile: path.join(browserRoot, "session.json"),
    },
  };
  return { root, context };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ChromeCdpRuntime", () => {
  it("launches loopback ephemeral CDP, validates version and implements the interactive lifecycle", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    let spawnedArgs: readonly string[] = [];
    let browserClient: FakeCdpClient;
    let pageClient: FakeCdpClient;
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      spawnProcess: (_executable, args) => {
        spawnedArgs = args;
        void writeFile(
          path.join(context.roots.profile, "DevToolsActivePort"),
          "49152\n/devtools/browser/browser-1\n",
          { mode: 0o600 },
        );
        return child;
      },
      fetchJson: async (_port, resource) => resource === "/json/version"
        ? {
          Browser: "HeadlessChrome/140.0.0.0",
          webSocketDebuggerUrl: "ws://localhost:49152/devtools/browser/browser-1",
        }
        : [{
          id: "page-1",
          type: "page",
          webSocketDebuggerUrl: "ws://localhost:49152/devtools/page/page-1",
        }],
      connectCdp: async (endpoint) => {
        if (endpoint.includes("/browser/")) {
          browserClient = new FakeCdpClient("browser", () => child.exit());
          return browserClient;
        }
        pageClient = new FakeCdpClient("page", () => child.exit());
        return pageClient;
      },
    });

    await runtime.start();
    expect(spawnedArgs).toContain("--remote-debugging-address=127.0.0.1");
    expect(spawnedArgs).toContain("--remote-debugging-port=0");
    expect(spawnedArgs).toContain(`--user-data-dir=${context.roots.profile}`);
    expect(spawnedArgs).not.toContain("--no-sandbox");
    expect(spawnedArgs.join(" ")).not.toContain("docker.sock");
    expect(runtime.debuggingPort).toBe(49_152);
    await expect(runtime.health()).resolves.toMatchObject({ healthy: true });
    await expect(runtime.captureFrame()).resolves.toMatchObject({
      schemaVersion: 1,
      mediaType: "image/png",
    });
    await expect(runtime.navigate("https://example.test"))
      .rejects.toMatchObject({ code: "CHROME_TAKEOVER_REQUIRED" });
    await runtime.takeOver();
    await runtime.navigate("https://example.test");
    await runtime.dispatchInput({
      kind: "mouse",
      event: "mousePressed",
      x: 100,
      y: 200,
      button: "left",
      clickCount: 1,
    });
    await runtime.dispatchInput({ kind: "key", event: "keyDown", key: "A", code: "KeyA" });
    await expect(runtime.currentUrl()).resolves.toBe("https://example.test/");
    await runtime.releaseTakeover();
    await runtime.stop();
    expect(child.exitCode).toBe(0);
    expect(browserClient!.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "Browser.setDownloadBehavior" }),
      expect.objectContaining({ method: "Browser.close" }),
    ]));
    expect(pageClient!.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "Page.navigate" }),
      expect.objectContaining({ method: "Input.dispatchMouseEvent" }),
      expect.objectContaining({ method: "Input.dispatchKeyEvent" }),
    ]));
  });

  it("closes a validated orphan through private CDP before reusing the same profile", async () => {
    const { context } = await contextFixture();
    await writeFile(
      path.join(context.roots.profile, "DevToolsActivePort"),
      "48111\n/devtools/browser/orphan-1\n",
      { mode: 0o600 },
    );
    const child = new FakeChromeProcess();
    let orphanAlive = true;
    let spawned = false;
    let orphanClosed = false;
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      spawnProcess: () => {
        spawned = true;
        void writeFile(
          path.join(context.roots.profile, "DevToolsActivePort"),
          "49153\n/devtools/browser/new-1\n",
          { mode: 0o600 },
        );
        return child;
      },
      fetchJson: async (port, resource) => {
        if (port === 48_111) {
          if (!orphanAlive) throw new Error("orphan stopped");
          return {
            Browser: "HeadlessChrome/139.0.0.0",
            webSocketDebuggerUrl: "ws://127.0.0.1:48111/devtools/browser/orphan-1",
          };
        }
        return resource === "/json/version"
          ? {
            Browser: "HeadlessChrome/140.0.0.0",
            webSocketDebuggerUrl: "ws://127.0.0.1:49153/devtools/browser/new-1",
          }
          : [{
            id: "page-new",
            type: "page",
            webSocketDebuggerUrl: "ws://127.0.0.1:49153/devtools/page/page-new",
          }];
      },
      connectCdp: async (endpoint) => {
        if (endpoint.includes("orphan-1")) {
          return new FakeCdpClient("browser", () => {
            orphanClosed = true;
            orphanAlive = false;
          });
        }
        return new FakeCdpClient(
          endpoint.includes("/browser/") ? "browser" : "page",
          () => child.exit(),
        );
      },
    });
    await runtime.start();
    expect(orphanClosed).toBe(true);
    expect(spawned).toBe(true);
    expect(runtime.debuggingPort).toBe(49_153);
    await runtime.stop();
  });

  it("validates markers, navigation schemes, launch arguments and production version pinning", async () => {
    const { context } = await contextFixture();
    expect(parseDevToolsActivePort("9222\n/devtools/browser/abc-123\n")).toEqual({
      port: 9_222,
      webSocketPath: "/devtools/browser/abc-123",
    });
    expect(() => parseDevToolsActivePort("9222\nhttp://outside\n")).toThrow(ChromeRuntimeError);
    expect(validateBrowserNavigationUrl("about:blank")).toBe("about:blank");
    expect(validateBrowserNavigationUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(() => validateBrowserNavigationUrl("file:///etc/passwd")).toThrow(ChromeRuntimeError);
    expect(() => validateBrowserNavigationUrl("https://user:pass@example.test"))
      .toThrow(ChromeRuntimeError);
    expect(buildChromeArguments(context)).not.toContain("--no-sandbox");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new ChromeBrowserRuntimeFactory()).toThrowError(
      expect.objectContaining({ code: "CHROME_VERSION_REQUIRED" }),
    );
  });
});
