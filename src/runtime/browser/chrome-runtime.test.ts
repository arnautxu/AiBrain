import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpClientError, type CdpSessionScope } from "@/runtime/browser/cdp-client";
import type { BrowserRuntimeContext } from "@/runtime/browser/types";
import { BrowserNetworkPolicy } from "@/runtime/browser/network-policy";
import {
  buildChromeArguments,
  ChromeBrowserRuntimeFactory,
  ChromeCdpRuntime,
  ChromeRuntimeError,
  probeChromeRuntimeCapability,
  validateBrowserNavigationUrl,
  type CdpClientLike,
} from "@/runtime/browser/chrome-runtime";

const roots: string[] = [];
const THREAD_A = "0198b9f0-6631-7000-8000-000000000411";
const THREAD_B = "0198b9f0-6631-7000-8000-000000000412";

class FakeChromeProcess extends EventEmitter {
  readonly pid = 42_001;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stderr = new PassThrough();
  readonly requestPipe = new PassThrough();
  readonly responsePipe = new PassThrough();
  readonly stdio = [null, null, this.stderr, this.requestPipe, this.responsePipe] as const;
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    this.signalCode = signal;
    this.emit("exit", null, signal);
    return true;
  }

  exit() {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

type FakeCommand = {
  method: string;
  params: Record<string, unknown>;
  sessionId: string | null;
};

class FakeCdpClient implements CdpClientLike {
  isOpen = true;
  readiness = { readyState: "complete", textLength: 0, linkCount: 0 };
  readonly commands: FakeCommand[] = [];
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>();
  private readonly targetUrls = new Map<string, string>();
  private readonly targetHistories = new Map<string, string[]>();
  private readonly targetHistoryIndexes = new Map<string, number>();
  private readonly sessionTargets = new Map<string, string>();
  private nextTarget = 1;
  private nextSession = 1;
  private readonly commandFailures = new Map<string, Error[]>();
  private readonly commandFailureAt = new Map<string, Array<{ remaining: number; error: Error }>>();
  private readonly commandBlocks = new Map<string, Array<{
    started: () => void;
    wait: Promise<void>;
  }>>();

  constructor(
    private readonly onBrowserClose: () => void,
    private readonly versionFailure?: Error,
  ) {}

  async send<Result = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    scope: CdpSessionScope = {},
  ) {
    const scopedSessionId = scope.sessionId ?? null;
    this.commands.push({ method, params, sessionId: scopedSessionId });
    const indexedFailure = this.commandFailureAt.get(method)?.[0];
    if (indexedFailure) {
      indexedFailure.remaining -= 1;
      if (indexedFailure.remaining === 0) {
        this.commandFailureAt.get(method)?.shift();
        throw indexedFailure.error;
      }
    }
    const failures = this.commandFailures.get(method);
    const failure = failures?.shift();
    if (failure) throw failure;
    const block = this.commandBlocks.get(method)?.shift();
    if (block) {
      block.started();
      await block.wait;
    }
    if (method === "Browser.getVersion") {
      if (this.versionFailure) throw this.versionFailure;
      return { product: "HeadlessChrome/140.0.0.0" } as Result;
    }
    if (method === "Browser.close") {
      this.onBrowserClose();
      return {} as Result;
    }
    if (method === "Target.createTarget") {
      const targetId = `target-${this.nextTarget++}`;
      this.targetUrls.set(targetId, "about:blank");
      this.targetHistories.set(targetId, ["about:blank"]);
      this.targetHistoryIndexes.set(targetId, 0);
      return { targetId } as Result;
    }
    if (method === "Target.attachToTarget") {
      const targetId = String(params.targetId);
      const sessionId = `session-${this.nextSession++}`;
      this.sessionTargets.set(sessionId, targetId);
      return { sessionId } as Result;
    }
    if (method === "Target.detachFromTarget") {
      const sessionId = String(params.sessionId);
      this.sessionTargets.delete(sessionId);
      this.emitEvent("Target.detachedFromTarget", { sessionId });
      return {} as Result;
    }
    if (method === "Target.closeTarget") {
      const targetId = String(params.targetId);
      this.targetUrls.delete(targetId);
      this.targetHistories.delete(targetId);
      this.targetHistoryIndexes.delete(targetId);
      return { success: true } as Result;
    }
    if (method === "Target.getTargets") {
      return {
        targetInfos: [...this.targetUrls].map(([targetId, url]) => ({ targetId, type: "page", url })),
      } as Result;
    }
    if (method === "Page.captureScreenshot") {
      return {
        data: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from(scopedSessionId ?? "browser"),
        ]).toString("base64"),
      } as Result;
    }
    if (method === "Page.navigate" && scopedSessionId) {
      const targetId = this.sessionTargets.get(scopedSessionId);
      if (targetId) {
        const url = String(params.url);
        const currentIndex = this.targetHistoryIndexes.get(targetId) ?? 0;
        const history = (this.targetHistories.get(targetId) ?? ["about:blank"]).slice(0, currentIndex + 1);
        history.push(url);
        this.targetHistories.set(targetId, history);
        this.targetHistoryIndexes.set(targetId, history.length - 1);
        this.targetUrls.set(targetId, url);
      }
      return {} as Result;
    }
    if (method === "Page.getNavigationHistory" && scopedSessionId) {
      const targetId = this.sessionTargets.get(scopedSessionId) as string;
      const history = this.targetHistories.get(targetId) ?? ["about:blank"];
      return {
        currentIndex: this.targetHistoryIndexes.get(targetId) ?? 0,
        entries: history.map((url, index) => ({ id: index + 1, url })),
      } as Result;
    }
    if (method === "Page.navigateToHistoryEntry" && scopedSessionId) {
      const targetId = this.sessionTargets.get(scopedSessionId) as string;
      const history = this.targetHistories.get(targetId) ?? ["about:blank"];
      const index = Number(params.entryId) - 1;
      if (history[index]) {
        this.targetHistoryIndexes.set(targetId, index);
        this.targetUrls.set(targetId, history[index]);
      }
      return {} as Result;
    }
    if (method === "Runtime.evaluate" && scopedSessionId) {
      if (String(params.expression).includes("document.readyState")) {
        return { result: { value: this.readiness } } as Result;
      }
      if (String(params.expression).includes("document.elementFromPoint")) {
        return { result: { value: { beforeX: 0, beforeY: 0, afterX: 0, afterY: 480 } } } as Result;
      }
      const targetId = this.sessionTargets.get(scopedSessionId);
      if (String(params.expression).includes("verifiable")) {
        return { result: { value: { verifiable: true, matched: true } } } as Result;
      }
      return {
        result: {
          value: {
            url: targetId ? this.targetUrls.get(targetId) ?? "about:blank" : "about:blank",
            title: "Synthetic page",
            text: "Untrusted synthetic page text",
            links: [{
              text: "Synthetic story",
              href: "https://example.test/story",
              selector: `a[data-aibrain-link="aibrain-${THREAD_A.replaceAll("-", "")}-0"]`,
            }],
            missing: false,
            tag: "button",
            role: "button",
            name: "Submit",
            href: "",
            inputType: "",
          },
        },
      } as Result;
    }
    if (method === "DOM.getDocument") return { root: { nodeId: 1 } } as Result;
    if (method === "DOM.querySelector") return { nodeId: 2 } as Result;
    if (method === "DOM.describeNode") return { node: { backendNodeId: 42 } } as Result;
    if (method === "DOM.getBoxModel") {
      return { model: { border: [0, 0, 100, 0, 100, 20, 0, 20] } } as Result;
    }
    return {} as Result;
  }

  on(method: string, listener: (params: unknown) => void, scope: CdpSessionScope = {}) {
    const key = `${scope.sessionId ?? "<browser>"}\u0000${method}`;
    const current = this.listeners.get(key) ?? new Set<(params: unknown) => void>();
    current.add(listener);
    this.listeners.set(key, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(key);
    };
  }

  emitEvent(method: string, params: unknown, sessionId?: string) {
    const key = `${sessionId ?? "<browser>"}\u0000${method}`;
    for (const listener of this.listeners.get(key) ?? []) listener(params);
  }

  sessionForTarget(targetId: string) {
    return [...this.sessionTargets].find(([, candidate]) => candidate === targetId)?.[0] ?? null;
  }

  failNext(method: string, error: Error) {
    const failures = this.commandFailures.get(method) ?? [];
    failures.push(error);
    this.commandFailures.set(method, failures);
  }

  failOnOccurrence(method: string, occurrence: number, error: Error) {
    const failures = this.commandFailureAt.get(method) ?? [];
    failures.push({ remaining: occurrence, error });
    this.commandFailureAt.set(method, failures);
  }

  blockNext(method: string) {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const blocks = this.commandBlocks.get(method) ?? [];
    blocks.push({ started: markStarted, wait });
    this.commandBlocks.set(method, blocks);
    return { started, release };
  }

  async close() {
    this.isOpen = false;
  }
}

function publicNetworkPolicy() {
  return new BrowserNetworkPolicy({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

function proxyAcceptsConnections(value: string) {
  const url = new URL(value);
  return new Promise<boolean>((resolve) => {
    const socket = netConnect({ host: url.hostname, port: Number(url.port) });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
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

describe("ChromeCdpRuntime private pipe", () => {
  it("keeps the graphikai footer scroll and FAQ click on the live session without CDP wheel dispatch", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      allowPrivateNetwork: true,
      spawnProcess: () => child,
      connectCdpPipe: () => client,
    });
    try {
      await runtime.start();
      await runtime.agentNavigate(THREAD_A, "https://graphikai.com/");
      await runtime.agentScroll(THREAD_A, 0, 5_000);
      await runtime.takeOver();
      await runtime.dispatchInput(THREAD_A, {
        kind: "mouse", event: "mouseWheel", x: 720, y: 780, deltaX: 0, deltaY: 640,
      });
      await runtime.dispatchInput(THREAD_A, {
        kind: "mouse", event: "mousePressed", x: 720, y: 640, button: "left", buttons: 1, clickCount: 1,
      });
      await runtime.dispatchInput(THREAD_A, {
        kind: "mouse", event: "mouseReleased", x: 720, y: 640, button: "left", buttons: 0, clickCount: 1,
      });

      expect(client.commands).toContainEqual(expect.objectContaining({
        method: "Runtime.evaluate",
        params: expect.objectContaining({ expression: "window.scrollBy({ left: 0, top: 5000, behavior: \"instant\" })" }),
      }));
      expect(client.commands).toContainEqual(expect.objectContaining({
        method: "Runtime.evaluate",
        params: expect.objectContaining({ expression: expect.stringContaining("document.elementFromPoint(720, 780)") }),
      }));
      expect(client.commands.filter((command) =>
        command.method === "Input.dispatchMouseEvent" && command.params.type === "mouseWheel")).toHaveLength(0);
      expect(client.commands.filter((command) =>
        command.method === "Input.dispatchMouseEvent" &&
        (command.params.type === "mousePressed" || command.params.type === "mouseReleased"))).toHaveLength(2);
      await expect(runtime.health()).resolves.toMatchObject({ healthy: true });
    } finally {
      await runtime.stop();
    }
  });

  it("accepts a complete form in one readiness RPC and rejects an unresolved document", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh", expectedVersion: "140.0.0.0",
      spawnProcess: () => child, connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(), shutdownTimeoutMs: 100,
    });
    try {
      await runtime.start();
      await runtime.agentNavigate(THREAD_A, "https://example.test/form");
      expect(client.commands.filter((command) => command.method === "Runtime.evaluate")).toHaveLength(1);
      client.readiness.readyState = "loading";
      await expect(runtime.agentNavigate(THREAD_A, "https://example.test/unresolved"))
        .rejects.toMatchObject({ code: "CHROME_DOCUMENT_NOT_READY" });
    } finally {
      await runtime.stop();
    }
  }, 10_000);

  it("reports an explicitly missing Chrome executable as unavailable instead of falling back", async () => {
    await expect(probeChromeRuntimeCapability({
      executablePath: "/definitely/missing/aibrain-chrome",
    })).resolves.toEqual({
      available: false,
      code: "CHROME_EXECUTABLE_NOT_FOUND",
    });
  });

  it("launches fd3/fd4 CDP, isolates thread sessions and preserves network, downloads and takeover", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    let nextDownload = 0;
    const downloadStart = vi.fn(async (_fileName: string) => ({
      id: `0198b9f0-6631-7000-8000-${String(500 + nextDownload++).padStart(12, "0")}`,
    }));
    const downloadFinish = vi.fn(async (
      _downloadId: string,
      _result: { status: "complete"; sizeBytes: number } | { status: "failed" },
    ) => undefined);
    const runtimeContext: BrowserRuntimeContext = {
      ...context,
      downloadProjection: { start: downloadStart, finish: downloadFinish },
    };
    let spawnedArgs: readonly string[] = [];
    let spawnedStdio: unknown;
    let connectedRequest: unknown;
    let connectedResponse: unknown;
    const runtime = new ChromeCdpRuntime(runtimeContext, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      spawnProcess: (_executable, args, options) => {
        spawnedArgs = args;
        spawnedStdio = options.stdio;
        return child;
      },
      connectCdpPipe: (request, response) => {
        connectedRequest = request;
        connectedResponse = response;
        return client;
      },
      networkPolicy: publicNetworkPolicy(),
    });

    await runtime.start();
    expect(spawnedArgs).toContain("--remote-debugging-pipe");
    expect(spawnedArgs).toContain("--disable-quic");
    expect(spawnedArgs).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(spawnedArgs).toContain("--proxy-bypass-list=<-loopback>");
    const proxyArgument = spawnedArgs.find((argument) => argument.startsWith("--proxy-server="));
    expect(proxyArgument).toMatch(/^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/u);
    const proxyUrl = (proxyArgument as string).slice("--proxy-server=".length);
    await expect(proxyAcceptsConnections(proxyUrl)).resolves.toBe(true);
    expect(spawnedArgs.some((argument) => argument.startsWith("--remote-debugging-port"))).toBe(false);
    expect(spawnedArgs.some((argument) => argument.startsWith("--remote-debugging-address"))).toBe(false);
    expect(spawnedArgs).toContain(`--user-data-dir=${context.roots.profile}`);
    expect(spawnedArgs).not.toContain("--no-sandbox");
    expect(spawnedStdio).toEqual(["ignore", "ignore", "pipe", "pipe", "pipe"]);
    expect(connectedRequest).toBe(child.requestPipe);
    expect(connectedResponse).toBe(child.responsePipe);
    await expect(runtime.health()).resolves.toMatchObject({ healthy: true });

    client.emitEvent("Target.targetCreated", {
      targetInfo: { targetId: "popup-unowned", type: "page", url: "https://popup.example.test", openerId: "external" },
    });
    client.emitEvent("Target.targetCreated", {
      targetInfo: { targetId: "worker-unowned", type: "service_worker", url: "https://popup.example.test/sw.js" },
    });
    client.emitEvent("Target.targetCreated", {
      targetInfo: { targetId: "tab-unowned", type: "tab", url: "https://popup.example.test" },
    });
    client.emitEvent("Target.targetCreated", {
      targetInfo: { targetId: "page-unowned", type: "page", url: "about:blank" },
    });
    await eventually(() => client.commands.some((command) =>
      command.method === "Target.closeTarget" && command.params.targetId === "popup-unowned"));
    expect(client.commands.some((command) => command.method === "Target.closeTarget" &&
      (command.params.targetId === "worker-unowned" || command.params.targetId === "tab-unowned"))).toBe(false);

    const [frameA, frameB] = await Promise.all([
      runtime.captureFrame(THREAD_A),
      runtime.captureFrame(THREAD_B),
    ]);
    expect(client.commands.some((command) =>
      command.method === "Target.closeTarget" && command.params.targetId === "page-unowned")).toBe(true);
    const targetA = runtime.targetIdFor(THREAD_A) as string;
    const targetB = runtime.targetIdFor(THREAD_B) as string;
    const sessionA = client.sessionForTarget(targetA) as string;
    const sessionB = client.sessionForTarget(targetB) as string;
    expect(targetA).not.toBe(targetB);
    expect(sessionA).not.toBe(sessionB);
    expect(frameA.dataBase64).not.toBe(frameB.dataBase64);
    expect(client.commands.filter((command) => command.method === "Fetch.enable"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ params: expect.objectContaining({ handleAuthRequests: true }) }),
      ]));
    client.emitEvent("Fetch.authRequired", {
      requestId: "proxy-auth-a",
      authChallenge: {
        source: "Proxy",
        origin: proxyUrl,
        scheme: "basic",
        realm: "aibrain-browser",
      },
    }, sessionA);
    client.emitEvent("Fetch.authRequired", {
      requestId: "server-auth-b",
      authChallenge: {
        source: "Server",
        origin: "https://b.example.test",
        scheme: "basic",
        realm: "target-server",
      },
    }, sessionB);
    await eventually(() => client.commands.filter((command) =>
      command.method === "Fetch.continueWithAuth").length === 2);
    const proxyAuth = client.commands.find((command) =>
      command.method === "Fetch.continueWithAuth" && command.params.requestId === "proxy-auth-a");
    expect(proxyAuth).toMatchObject({
      sessionId: sessionA,
      params: {
        authChallengeResponse: {
          response: "ProvideCredentials",
          username: "aibrain-browser",
          password: expect.stringMatching(/^[A-Za-z0-9_-]{32,256}$/u),
        },
      },
    });
    expect(client.commands.find((command) =>
      command.method === "Fetch.continueWithAuth" && command.params.requestId === "server-auth-b"))
      .toMatchObject({ params: { authChallengeResponse: { response: "CancelAuth" } } });
    expect(spawnedArgs.join("\n")).not.toContain(String(
      (proxyAuth?.params.authChallengeResponse as Record<string, unknown>)?.password,
    ));

    await expect(runtime.navigate(THREAD_A, "https://a.example.test/path"))
      .rejects.toMatchObject({ code: "CHROME_TAKEOVER_REQUIRED" });
    await runtime.agentNavigate(THREAD_A, "https://agent.example.test/path");
    await expect(runtime.readPage(THREAD_A)).resolves.toMatchObject({
      url: "https://agent.example.test/path",
      title: "Synthetic page",
      links: [{ text: "Synthetic story", href: "https://example.test/story" }],
    });
    await expect(runtime.agentCaptureFrame(THREAD_A)).resolves.toMatchObject({ mediaType: "image/png" });
    await runtime.agentScroll(THREAD_A, 0, 250);
    expect(client.commands).toContainEqual(expect.objectContaining({
      method: "Runtime.evaluate",
      params: expect.objectContaining({
        expression: "window.scrollBy({ left: 0, top: 250, behavior: \"instant\" })",
      }),
    }));
    await runtime.agentClick(THREAD_A, "button[type=submit]");
    expect(client.commands).toContainEqual(expect.objectContaining({
      method: "DOM.scrollIntoViewIfNeeded",
      params: { nodeId: 2 },
    }));
    const clickedFrame = await runtime.captureFrame(THREAD_A);
    expect(clickedFrame.pointerTrail).toHaveLength(1);
    expect(clickedFrame.pointerTrail?.[0]?.x).toBeCloseTo((50 / 1_440) * 100);
    expect(clickedFrame.pointerTrail?.[0]?.y).toBeCloseTo((10 / 900) * 100);
    await runtime.agentType(THREAD_A, "input[name=email]", "person@example.test", true);
    await expect(runtime.listTabs(THREAD_A)).resolves.toEqual([
      expect.objectContaining({ id: THREAD_A, url: "https://agent.example.test/path", active: true }),
    ]);
    await expect(runtime.listDownloads(THREAD_A)).resolves.toEqual([]);
    await runtime.takeOver();
    await expect(runtime.agentCaptureFrame(THREAD_A)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.readPage(THREAD_A)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.listTabs(THREAD_A)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.listDownloads(THREAD_A)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.agentNavigate(THREAD_A, "https://blocked.example.test"))
      .rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.agentScroll(THREAD_A, 0, 100)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.agentClick(THREAD_A, "button")).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await expect(runtime.agentType(THREAD_A, "input", "blocked", true))
      .rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
    await Promise.all([
      runtime.navigate(THREAD_A, "https://a.example.test/path"),
      runtime.navigate(THREAD_B, "https://b.example.test/path"),
      runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyDown", key: "A" }),
      runtime.dispatchInput(THREAD_B, { kind: "key", event: "keyDown", key: "B" }),
    ]);
    await runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mouseMoved", x: 42, y: 24, button: "left", buttons: 1,
    });
    expect(client.commands).toContainEqual(expect.objectContaining({
      method: "Input.dispatchMouseEvent",
      params: expect.objectContaining({ type: "mouseMoved", button: "left", buttons: 1 }),
    }));
    await runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mouseMoved", x: 43, y: 25, button: "left",
    });
    expect(client.commands.at(-1)?.params).not.toHaveProperty("buttons");
    const wheelDispatchesBefore = client.commands.filter((command) =>
      command.method === "Input.dispatchMouseEvent" && command.params.type === "mouseWheel").length;
    await runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mouseWheel", x: 320, y: 240, button: "none", deltaX: 0, deltaY: 480,
    });
    expect(client.commands.filter((command) =>
      command.method === "Input.dispatchMouseEvent" && command.params.type === "mouseWheel")).toHaveLength(wheelDispatchesBefore);
    expect(client.commands.at(-1)).toMatchObject({
      method: "Runtime.evaluate",
      params: { expression: expect.stringContaining("document.elementFromPoint(320, 240)") },
    });
    await expect(runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mouseMoved", x: 42, y: 24, button: "left", buttons: 8,
    })).rejects.toMatchObject({ code: "CHROME_INPUT_REJECTED" });
    await expect(runtime.navigate(THREAD_A, "http://169.254.169.254/latest/meta-data/"))
      .rejects.toMatchObject({ code: "BROWSER_NETWORK_PRIVATE_DESTINATION" });
    await expect(runtime.currentUrl(THREAD_A)).resolves.toBe("https://a.example.test/path");
    await expect(runtime.currentUrl(THREAD_B)).resolves.toBe("https://b.example.test/path");
    await expect(runtime.captureFrame(THREAD_A)).resolves.toMatchObject({ pointerTrail: [] });

    client.emitEvent("Fetch.requestPaused", {
      requestId: "allowed-a",
      request: { url: "https://a.example.test/app.js" },
    }, sessionA);
    client.emitEvent("Fetch.requestPaused", {
      requestId: "blocked-b",
      request: { url: "http://127.0.0.1/private" },
    }, sessionB);
    await eventually(() => client.commands.some((command) =>
      command.method === "Fetch.continueRequest" && command.params.requestId === "allowed-a" &&
      command.sessionId === sessionA) && client.commands.some((command) =>
      command.method === "Fetch.failRequest" && command.params.requestId === "blocked-b" &&
      command.sessionId === sessionB));
    expect(client.commands.some((command) =>
      command.params.requestId === "blocked-b" && command.sessionId === sessionA)).toBe(false);

    await Promise.all([
      writeFile(path.join(context.roots.browserRoot, "download-quarantine", "guid-a"), "A"),
      writeFile(path.join(context.roots.browserRoot, "download-quarantine", "guid-b"), "B"),
    ]);
    client.emitEvent("Page.downloadWillBegin", { guid: "guid-a", suggestedFilename: "same.txt" }, sessionA);
    client.emitEvent("Page.downloadWillBegin", { guid: "guid-b", suggestedFilename: "same.txt" }, sessionB);
    client.emitEvent("Page.downloadProgress", { guid: "guid-a", state: "completed" }, sessionA);
    client.emitEvent("Page.downloadProgress", { guid: "guid-b", state: "completed" }, sessionB);
    const downloadA = path.join(context.roots.downloads, THREAD_A, "same.txt");
    const downloadB = path.join(context.roots.downloads, THREAD_B, "same.txt");
    await eventually(async () => Promise.all([
      readFile(downloadA, "utf8").then((value) => value === "A").catch(() => false),
      readFile(downloadB, "utf8").then((value) => value === "B").catch(() => false),
    ]).then((values) => values.every(Boolean)));
    await eventually(() => downloadFinish.mock.calls.length === 2);
    expect(downloadStart).toHaveBeenCalledTimes(2);
    expect(downloadFinish.mock.calls.map(([, result]) => result)).toEqual([
      { status: "complete", sizeBytes: 1 },
      { status: "complete", sizeBytes: 1 },
    ]);

    await expect(runtime.captureFrame("0198b9f0-6631-7000-8000-000000000413"))
      .resolves.toMatchObject({ mediaType: "image/png" });
    await runtime.stop();
    expect(child.exitCode).toBe(0);
    expect(client.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "Target.attachToTarget" }),
      expect.objectContaining({ method: "Target.detachFromTarget" }),
      expect.objectContaining({ method: "Target.closeTarget" }),
      expect.objectContaining({ method: "Browser.close" }),
    ]));
    expect(client.isOpen).toBe(false);
    await expect(proxyAcceptsConnections(proxyUrl)).resolves.toBe(false);
  });

  it("applies target backpressure and recreates only a detached thread session", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      maxThreadTargets: 2,
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await Promise.all([runtime.captureFrame(THREAD_A), runtime.captureFrame(THREAD_B)]);
    await expect(runtime.captureFrame("0198b9f0-6631-7000-8000-000000000413"))
      .rejects.toMatchObject({ code: "CHROME_TARGET_BACKPRESSURE" });
    const oldTargetA = runtime.targetIdFor(THREAD_A) as string;
    const sessionA = client.sessionForTarget(oldTargetA) as string;
    client.emitEvent("Target.detachedFromTarget", { sessionId: sessionA });
    await runtime.captureFrame(THREAD_A);
    expect(runtime.targetIdFor(THREAD_A)).not.toBe(oldTargetA);
    expect(runtime.targetIdFor(THREAD_B)).not.toBeNull();
    await expect(runtime.captureFrame("not-a-thread"))
      .rejects.toMatchObject({ code: "CHROME_THREAD_INVALID" });
    await runtime.stop();
  });

  it.each(["takeover", "release"] as const)("resets an in-flight held button before %s and fences queued old input", async (boundary) => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh", expectedVersion: "140.0.0.0",
      spawnProcess: () => child, connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.takeOver();
    await runtime.captureFrame(THREAD_A);
    const session = client.sessionForTarget(runtime.targetIdFor(THREAD_A) as string);
    const block = client.blockNext("Input.dispatchMouseEvent");
    const press = runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mousePressed", x: 42, y: 24, button: "left", buttons: 1,
    });
    await block.started;
    const queued = runtime.dispatchInput(THREAD_B, {
      kind: "mouse", event: "mousePressed", x: 99, y: 88, button: "left", buttons: 1,
    });
    const queuedRejected = expect(queued).rejects.toBeInstanceOf(ChromeRuntimeError);
    const changed = boundary === "takeover" ? runtime.takeOver() : runtime.releaseTakeover();
    block.release();
    await press;
    await queuedRejected;
    await changed;
    const mouse = client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent");
    expect(mouse.map(({ params }) => params.type)).toEqual(["mousePressed", "mouseReleased"]);
    expect(mouse[1]).toMatchObject({ sessionId: session,
      params: { x: 42, y: 24, button: "left", buttons: 0 } });
    await runtime.takeOver();
    await runtime.dispatchInput(THREAD_B, { kind: "key", event: "keyDown", key: "n" });
    expect(client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(2);
    await runtime.stop();
  });

  it("resets a possibly dispatched press after a lost response and keeps failed cleanup fenced", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh", expectedVersion: "140.0.0.0",
      spawnProcess: () => child, connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.takeOver();
    client.failNext("Input.dispatchMouseEvent", new Error("Press response lost"));
    await expect(runtime.dispatchInput(THREAD_A, {
      kind: "mouse", event: "mousePressed", x: 31, y: 21, button: "left", buttons: 1,
    })).rejects.toThrow("Press response lost");
    client.failNext("Input.dispatchMouseEvent", new Error("Release response lost"));
    await expect(runtime.takeOver()).rejects.toThrow("Release response lost");
    await expect(runtime.dispatchInput(THREAD_B, { kind: "key", event: "keyDown", key: "n" }))
      .rejects.toBeInstanceOf(ChromeRuntimeError);
    await runtime.takeOver();
    const mouse = client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent");
    expect(mouse.map(({ params }) => params.type)).toEqual(["mousePressed", "mouseReleased", "mouseReleased"]);
    expect(mouse[2]).toMatchObject({ params: { x: 31, y: 21, button: "left", buttons: 0 } });
    await runtime.releaseTakeover();
    expect(client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(3);
    await runtime.stop();
  });

  it("never replays manual input when CDP reports a stale target after dispatch", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.takeOver();
    await runtime.captureFrame(THREAD_A);
    client.failNext("Input.dispatchKeyEvent", new CdpClientError(
      "CDP_COMMAND_FAILED", "Input.dispatchKeyEvent failed: Not attached to an active page",
    ));
    await expect(runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyDown", key: "a", text: "a" }))
      .rejects.toMatchObject({ code: "CDP_COMMAND_FAILED" });
    expect(client.commands.filter(({ method }) => method === "Input.dispatchKeyEvent")).toHaveLength(1);
    await runtime.stop();
  });

  it.each(["navigate", "reload"] as const)("does not repeat %s after an uncertain command or stale history readback", async (action) => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh", expectedVersion: "140.0.0.0",
      spawnProcess: () => child, connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.takeOver();
    await runtime.captureFrame(THREAD_A);
    client.failNext(action === "navigate" ? "Page.navigate" : "Page.getNavigationHistory", new CdpClientError(
      "CDP_COMMAND_FAILED", "Runtime.evaluate failed: Not attached to an active page",
    ));
    const before = client.commands.length;
    await expect(action === "navigate"
      ? runtime.navigate(THREAD_A, "https://example.test/one-mutation")
      : runtime.navigateHistory(THREAD_A, "reload"))
      .rejects.toMatchObject({ code: "CDP_COMMAND_FAILED" });
    expect(client.commands.slice(before).filter(({ method }) => method === (action === "navigate" ? "Page.navigate" : "Page.reload")))
      .toHaveLength(1);
    await runtime.stop();
  });

  it("recreates only a stale thread target and restores its URL once", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.agentNavigate(THREAD_A, "https://example.test/recover");
    const staleTarget = runtime.targetIdFor(THREAD_A);
    client.failNext("Page.captureScreenshot", new CdpClientError(
      "CDP_COMMAND_FAILED",
      "Page.captureScreenshot failed: Session not found",
    ));

    await expect(runtime.agentCaptureFrame(THREAD_A)).resolves.toMatchObject({ mediaType: "image/png" });
    expect(runtime.targetIdFor(THREAD_A)).not.toBe(staleTarget);
    await expect(runtime.currentUrl(THREAD_A)).resolves.toBe("https://example.test/recover");
    expect(client.commands.filter(({ method }) => method === "Page.captureScreenshot")).toHaveLength(2);
    await runtime.stop();
  });

  it("serializes CDP work during navigation dispatch and keeps health checks non-intrusive while busy", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    const navigationBlock = client.blockNext("Page.navigate");
    const navigation = runtime.agentNavigate(THREAD_A, "https://example.test/busy");
    await navigationBlock.started;
    const frame = runtime.agentCaptureFrame(THREAD_A);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(client.commands.some(({ method }) => method === "Page.captureScreenshot")).toBe(false);
    const versionChecks = client.commands.filter(({ method }) => method === "Browser.getVersion").length;
    await expect(runtime.health()).resolves.toMatchObject({ healthy: true });
    expect(client.commands.filter(({ method }) => method === "Browser.getVersion")).toHaveLength(versionChecks);
    navigationBlock.release();
    await navigation;
    await expect(frame).resolves.toMatchObject({ mediaType: "image/png" });
    expect(client.commands.findIndex(({ method }) => method === "Page.captureScreenshot"))
      .toBeGreaterThan(client.commands.findIndex(({ method }) => method === "Page.navigate"));
    await runtime.stop();
  });

  it("retries a transient screenshot on the same target so read selectors stay valid", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.agentNavigate(THREAD_A, "https://example.test/transient");
    await runtime.readPage(THREAD_A);
    const target = runtime.targetIdFor(THREAD_A);
    client.failNext("Page.captureScreenshot", new CdpClientError(
      "CDP_COMMAND_FAILED",
      "Page.captureScreenshot failed.",
    ));

    await expect(runtime.agentCaptureFrame(THREAD_A)).resolves.toMatchObject({ mediaType: "image/png" });
    expect(runtime.targetIdFor(THREAD_A)).toBe(target);
    expect(client.commands.filter(({ method }) => method === "Page.captureScreenshot")).toHaveLength(2);
    await runtime.stop();
  });

  it("revalidates the approved browser target and reports unprovable clicks as dispatched", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    const command = { action: "click" as const, selector: "button[type=submit]" };
    const prepared = await runtime.prepareAgentMutation(THREAD_A, command);
    const applied = await runtime.executeAgentMutation(THREAD_A, command, prepared, "a".repeat(64));
    expect(applied).toMatchObject({
      outcome: "dispatched",
      verification: "cdp-dispatch-acknowledged",
      actionKind: "click",
      evidenceFingerprint: "a".repeat(64),
      resource: expect.objectContaining({ scopeId: THREAD_A, locatorHash: expect.any(String) }),
    });
    expect(client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(3);

    const stale = await runtime.prepareAgentMutation(THREAD_A, command);
    const target = runtime.targetIdFor(THREAD_A) as string;
    client.emitEvent("Page.frameNavigated", {
      frame: { url: "https://example.test/changed", loaderId: "changed-loader" },
    }, client.sessionForTarget(target) as string);
    await expect(runtime.executeAgentMutation(THREAD_A, command, stale, "b".repeat(64)))
      .rejects.toMatchObject({ code: "CHROME_ACTION_EVIDENCE_MISMATCH" });
    expect(client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(3);
    await runtime.stop();
  });

  it("verifies a cleared typed value without returning its secret and fails closed if readback fails", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    const command = { action: "type" as const, selector: "input[name=password]", text: "never-log-this", clear: true };
    const prepared = await runtime.prepareAgentMutation(THREAD_A, command);
    const applied = await runtime.executeAgentMutation(THREAD_A, command, prepared, "d".repeat(64));
    expect(applied).toMatchObject({
      outcome: "applied",
      verification: "type-value-matched",
      actionKind: "type",
    });
    expect(JSON.stringify(applied)).not.toContain("never-log-this");

    const failedCommand = { ...command, text: "still-secret" };
    const failedPrepared = await runtime.prepareAgentMutation(THREAD_A, failedCommand);
    client.failOnOccurrence("Runtime.evaluate", 2, new CdpClientError(
      "CDP_COMMAND_FAILED",
      "Runtime.evaluate failed after Input.insertText.",
    ));
    await expect(runtime.executeAgentMutation(THREAD_A, failedCommand, failedPrepared, "e".repeat(64)))
      .rejects.toMatchObject({ code: "CDP_COMMAND_FAILED" });
    expect(client.commands.filter(({ method }) => method === "Input.insertText")).toHaveLength(2);
    await runtime.stop();
  });

  it("does not retry an approval-bound mutation after Chrome fails during dispatch", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    const command = { action: "click" as const, selector: "button[type=submit]" };
    const prepared = await runtime.prepareAgentMutation(THREAD_A, command);
    const target = runtime.targetIdFor(THREAD_A);
    client.failOnOccurrence("Input.dispatchMouseEvent", 2, new CdpClientError(
      "CDP_COMMAND_FAILED",
      "Input.dispatchMouseEvent failed after delivery uncertainty.",
    ));
    await expect(runtime.executeAgentMutation(THREAD_A, command, prepared, "c".repeat(64)))
      .rejects.toMatchObject({ code: "CDP_COMMAND_FAILED" });
    expect(runtime.targetIdFor(THREAD_A)).toBe(target);
    expect(client.commands.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(2);
    await runtime.stop();
  });

  it("restores the last private URL for each thread after a browser process restart", async () => {
    const { context } = await contextFixture();
    const firstChild = new FakeChromeProcess();
    const firstClient = new FakeCdpClient(() => firstChild.exit());
    const first = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => firstChild,
      connectCdpPipe: () => firstClient,
      networkPolicy: publicNetworkPolicy(),
    });
    await first.start();
    await Promise.all([
      first.agentNavigate(THREAD_A, "https://a.example.test/recover"),
      first.agentNavigate(THREAD_B, "https://b.example.test/recover"),
    ]);
    await first.stop();

    const secondChild = new FakeChromeProcess();
    const secondClient = new FakeCdpClient(() => secondChild.exit());
    const second = new ChromeCdpRuntime({
      ...context,
      browserSessionId: "0198b9f0-6631-7000-8000-000000000403",
      generation: 2,
      recovering: true,
    }, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => secondChild,
      connectCdpPipe: () => secondClient,
      networkPolicy: publicNetworkPolicy(),
    });
    await second.start();
    await Promise.all([second.captureFrame(THREAD_A), second.captureFrame(THREAD_B)]);
    await expect(second.currentUrl(THREAD_A)).resolves.toBe("https://a.example.test/recover");
    await expect(second.currentUrl(THREAD_B)).resolves.toBe("https://b.example.test/recover");
    expect(secondClient.commands.filter((command) => command.method === "Page.navigate"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ params: { url: "https://a.example.test/recover" } }),
        expect.objectContaining({ params: { url: "https://b.example.test/recover" } }),
      ]));
    await second.stop();
  });

  it("exposes bounded viewer navigation and supports back, forward and reload under human control", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => child,
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    await runtime.takeOver();
    await runtime.navigate(THREAD_A, "https://example.test/one");
    await runtime.navigate(THREAD_A, "https://example.test/two");
    await expect(runtime.viewerNavigationState(THREAD_A)).resolves.toEqual({
      url: "https://example.test/two",
      canGoBack: true,
      canGoForward: false,
    });
    await expect(runtime.navigateHistory(THREAD_A, "back")).resolves.toEqual({
      url: "https://example.test/one",
      canGoBack: true,
      canGoForward: true,
    });
    await expect(runtime.navigateHistory(THREAD_A, "forward")).resolves.toMatchObject({
      url: "https://example.test/two",
    });
    await expect(runtime.navigateHistory(THREAD_A, "reload")).resolves.toMatchObject({
      url: "https://example.test/two",
    });
    expect(client.commands.filter(({ method }) => method === "Page.navigateToHistoryEntry")).toHaveLength(2);
    expect(client.commands.filter(({ method }) => method === "Page.reload")).toHaveLength(1);
    await runtime.stop();
  });

  it("retries a failed pipe handshake with bounded child cleanup instead of reconnecting", async () => {
    const { context } = await contextFixture();
    const children = [new FakeChromeProcess(), new FakeChromeProcess()];
    const clients = [
      new FakeCdpClient(() => children[0].exit(), new Error("pipe startup race")),
      new FakeCdpClient(() => children[1].exit()),
    ];
    let spawnCount = 0;
    let connectCount = 0;
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 50,
      spawnProcess: () => children[spawnCount++],
      connectCdpPipe: () => clients[connectCount++],
      networkPolicy: publicNetworkPolicy(),
    });
    await runtime.start();
    expect(spawnCount).toBe(2);
    expect(connectCount).toBe(2);
    expect(children[0].signals).toContain("SIGTERM");
    expect(clients[0].isOpen).toBe(false);
    await runtime.stop();
  });

  it("validates navigation, pipe launch arguments and production version pinning", async () => {
    const { context } = await contextFixture();
    expect(validateBrowserNavigationUrl("about:blank")).toBe("about:blank");
    expect(validateBrowserNavigationUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(() => validateBrowserNavigationUrl("file:///etc/passwd")).toThrow(ChromeRuntimeError);
    expect(() => validateBrowserNavigationUrl("https://user:pass@example.test"))
      .toThrow(ChromeRuntimeError);
    const args = buildChromeArguments(context, "http://127.0.0.1:49152");
    expect(args).toContain("--remote-debugging-pipe");
    expect(args).toContain("--disable-quic");
    expect(args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(args).toContain("--force-device-scale-factor=1");
    expect(args).toContain("--proxy-server=http://127.0.0.1:49152");
    expect(args).toContain("--proxy-bypass-list=<-loopback>");
    expect(args.some((argument) => argument.includes("remote-debugging-port"))).toBe(false);
    expect(args.some((argument) => argument.includes("remote-debugging-address"))).toBe(false);
    expect(args).not.toContain("--no-sandbox");
    expect(() => buildChromeArguments(context, "http://localhost:49152"))
      .toThrowError(expect.objectContaining({ code: "CHROME_PROXY_URL_INVALID" }));
    const privateOverrideArgs = buildChromeArguments(context, null);
    expect(privateOverrideArgs).toContain("--disable-quic");
    expect(privateOverrideArgs.some((argument) => argument.startsWith("--proxy-server="))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new ChromeBrowserRuntimeFactory()).toThrowError(
      expect.objectContaining({ code: "CHROME_VERSION_REQUIRED" }),
    );
    expect(() => new ChromeBrowserRuntimeFactory({
      expectedVersion: "140.0.0.0",
      allowPrivateNetwork: true,
    })).toThrowError(expect.objectContaining({
      code: "BROWSER_NETWORK_PRODUCTION_OVERRIDE_FORBIDDEN",
    }));
  });

  it("stops the pinned egress proxy when Chrome version validation fails", async () => {
    const { context } = await contextFixture();
    const child = new FakeChromeProcess();
    const client = new FakeCdpClient(() => child.exit());
    let proxyUrl = "";
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "141.0.0.0",
      startupTimeoutMs: 500,
      shutdownTimeoutMs: 50,
      spawnProcess: (_executable, args) => {
        const proxyArgument = args.find((argument) => argument.startsWith("--proxy-server="));
        proxyUrl = proxyArgument?.slice("--proxy-server=".length) ?? "";
        return child;
      },
      connectCdpPipe: () => client,
      networkPolicy: publicNetworkPolicy(),
    });
    await expect(runtime.start()).rejects.toMatchObject({ code: "CHROME_VERSION_MISMATCH" });
    expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    await expect(proxyAcceptsConnections(proxyUrl)).resolves.toBe(false);
    expect(child.exitCode).toBe(0);
    await expect(runtime.health()).resolves.toMatchObject({ healthy: false });
  });

  it("rejects unsafe stale quarantine entries before spawning Chrome", async () => {
    const { root, context } = await contextFixture();
    const quarantine = path.join(context.roots.browserRoot, "download-quarantine");
    const outside = path.join(root, "outside-download");
    await mkdir(quarantine, { mode: 0o700 });
    await writeFile(outside, "do-not-delete", { mode: 0o600 });
    await symlink(outside, path.join(quarantine, "unsafe-link"));
    let spawned = false;
    const runtime = new ChromeCdpRuntime(context, {
      executablePath: "/bin/sh",
      expectedVersion: "140.0.0.0",
      spawnProcess: () => {
        spawned = true;
        return new FakeChromeProcess();
      },
      networkPolicy: publicNetworkPolicy(),
    });
    await expect(runtime.start()).rejects.toMatchObject({
      code: "CHROME_DOWNLOAD_QUARANTINE_UNSAFE",
    });
    expect(spawned).toBe(false);
    await expect(readFile(outside, "utf8")).resolves.toBe("do-not-delete");
  });
});
