import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallationConfig } from "@/config/installation-schema";
import {
  BrowserGatewayTokenError,
  BrowserGatewayTokenService,
  BrowserRegistryBackpressureError,
  BrowserRuntimeRegistry,
  BrowserSessionStore,
  type BrowserRuntimeContext,
  type BrowserRuntimeFactory,
  type ManagedBrowserRuntime,
} from "@/runtime/browser";
import { StorageCorruptionError } from "@/storage";

const USER_A = "0198b9f0-6631-7000-8000-000000000301";
const USER_B = "0198b9f0-6631-7000-8000-000000000302";
const THREAD_A = "0198b9f0-6631-7000-8000-000000000303";
const THREAD_B = "0198b9f0-6631-7000-8000-000000000304";
const roots: string[] = [];

function installation(root: string): Readonly<InstallationConfig> {
  const dataRoot = path.join(root, "data");
  return {
    schemaVersion: 1,
    installationId: "browser-lab",
    companyName: "Browser Lab",
    companySlug: "browser-lab",
    publicUrl: "http://localhost:3000",
    branding: {
      productName: "Browser Brain",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      accentColor: "#334455",
    },
    paths: {
      dataRoot,
      companyContextRoot: path.join(dataRoot, "company"),
      usersRoot: path.join(dataRoot, "users"),
      sourceReadRoot: path.join(root, "source-ro"),
      publishWriteRoot: path.join(root, "publish-rw"),
      backupsRoot: path.join(dataRoot, "backups"),
    },
  };
}

async function fixture(options: { now?: () => number; heartbeatTtlMs?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-browser-"));
  roots.push(root);
  const config = installation(root);
  const store = new BrowserSessionStore({ config, ...options });
  return { root, config, store };
}

class FakeBrowserRuntime implements ManagedBrowserRuntime {
  started = false;
  stopped = false;
  human = false;
  navigations: string[] = [];
  inputs: unknown[] = [];

  constructor(private readonly startBarrier?: Promise<void>, private readonly onStart?: () => void) {}

  async start() {
    this.onStart?.();
    if (this.startBarrier) await this.startBarrier;
    this.started = true;
  }
  async health() {
    return { healthy: this.started && !this.stopped };
  }
  async takeOver() {
    this.human = true;
  }
  async releaseTakeover() {
    this.human = false;
  }
  async stop() {
    this.stopped = true;
  }
  async captureFrame(threadId: string) {
    return {
      schemaVersion: 1 as const,
      mediaType: "image/png" as const,
      dataBase64: Buffer.from(`frame:${threadId}`).toString("base64"),
      capturedAt: "2026-08-27T00:00:00.000Z",
    };
  }
  async viewerNavigationState() {
    return {
      schemaVersion: 1 as const,
      url: "about:blank",
      title: "",
      canGoBack: false,
      canGoForward: false,
    };
  }
  async navigateHistory(threadId: string, direction: "back" | "forward" | "reload") {
    this.navigations.push(`${threadId}:history:${direction}`);
    return this.viewerNavigationState();
  }
  async agentCaptureFrame(threadId: string) {
    return this.captureFrame(threadId);
  }
  async readPage() {
    return { schemaVersion: 1 as const, url: "about:blank", title: "", text: "", links: [] };
  }
  async listTabs(threadId: string) {
    return [{ id: threadId, url: "about:blank", title: "", active: true as const }];
  }
  async listDownloads() {
    return [];
  }
  async agentNavigate(threadId: string, url: string) {
    this.navigations.push(`agent:${threadId}:${url}`);
  }
  async agentScroll(threadId: string, deltaX: number, deltaY: number) {
    this.inputs.push({ threadId, command: { action: "scroll", deltaX, deltaY } });
  }
  async agentClick(threadId: string, selector: string) {
    this.inputs.push({ threadId, command: { action: "click", selector } });
  }
  async agentType(threadId: string, selector: string, text: string, clear: boolean) {
    this.inputs.push({ threadId, command: { action: "type", selector, text, clear } });
  }
  async navigate(threadId: string, url: string) {
    this.navigations.push(`${threadId}:${url}`);
  }
  async dispatchInput(threadId: string, command: unknown) {
    this.inputs.push({ threadId, command });
  }
}

class FakeBrowserFactory implements BrowserRuntimeFactory {
  readonly contexts: BrowserRuntimeContext[] = [];
  readonly runtimes: FakeBrowserRuntime[] = [];

  constructor(
    private readonly barrier?: Promise<void>,
    private readonly onStart?: () => void,
  ) {}

  create(context: BrowserRuntimeContext) {
    this.contexts.push(context);
    const runtime = new FakeBrowserRuntime(
      this.runtimes.length === 0 ? this.barrier : undefined,
      this.runtimes.length === 0 ? this.onStart : undefined,
    );
    this.runtimes.push(runtime);
    return runtime;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BrowserSessionStore", () => {
  it("persists isolated profile, download and session state across store restart", async () => {
    const { config, store } = await fixture();
    const initial = await store.load(USER_A);
    expect(initial).toMatchObject({ lifecycle: "stopped", downloads: [] });
    const starting = await store.createSession(USER_A);
    const sessionId = starting.browserSessionId as string;
    await store.markReady(USER_A, sessionId);
    const download = await store.startDownload(USER_A, sessionId, "report.pdf");
    await store.finishDownload(USER_A, sessionId, download.id, {
      status: "complete",
      sizeBytes: 12_345,
    });
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      store.startDownload(USER_A, sessionId, `concurrent-${index}.txt`)));

    const other = await store.load(USER_B);
    expect(other.browserSessionId).toBeNull();
    expect(other.downloads).toEqual([]);
    const restarted = new BrowserSessionStore({ config });
    const recovered = await restarted.load(USER_A);
    expect(recovered).toMatchObject({
      browserSessionId: sessionId,
      lifecycle: "ready",
      controller: "agent",
      downloads: expect.arrayContaining([expect.objectContaining({
          id: download.id,
          fileName: "report.pdf",
          status: "complete",
          sizeBytes: 12_345,
        })]),
    });
    expect(recovered.downloads).toHaveLength(13);
    const [rootsA, rootsB] = await Promise.all([store.roots(USER_A), store.roots(USER_B)]);
    expect(rootsA.profile).not.toBe(rootsB.profile);
    expect(rootsA.downloads).not.toBe(rootsB.downloads);
    expect(rootsA.profile.startsWith(path.join(config.paths.usersRoot, USER_A))).toBe(true);
  });

  it("bounds durable download metadata without dropping active records", async () => {
    const { config } = await fixture();
    const store = new BrowserSessionStore({ config, maxDownloadRecords: 3 });
    const starting = await store.createSession(USER_A);
    const sessionId = starting.browserSessionId as string;
    await store.markReady(USER_A, sessionId);
    for (const fileName of ["one.txt", "two.txt", "three.txt"]) {
      const download = await store.startDownload(USER_A, sessionId, fileName);
      await store.finishDownload(USER_A, sessionId, download.id, { status: "failed" });
    }
    await store.startDownload(USER_A, sessionId, "four.txt");
    await expect(store.load(USER_A)).resolves.toMatchObject({
      downloads: [
        expect.objectContaining({ fileName: "two.txt" }),
        expect.objectContaining({ fileName: "three.txt" }),
        expect.objectContaining({ fileName: "four.txt", status: "active" }),
      ],
    });

    const activeOnly = new BrowserSessionStore({ config, maxDownloadRecords: 3 });
    await activeOnly.finishDownload(USER_A, sessionId, (await activeOnly.load(USER_A)).downloads[2]!.id, { status: "failed" });
    for (const fileName of ["five.txt", "six.txt", "seven.txt"]) {
      await activeOnly.startDownload(USER_A, sessionId, fileName);
    }
    await expect(activeOnly.startDownload(USER_A, sessionId, "eight.txt"))
      .rejects.toMatchObject({ code: "BROWSER_DOWNLOAD_BACKPRESSURE" });

    const recovering = await activeOnly.beginRecovery(USER_A, sessionId, "process_restart");
    expect(recovering.downloads.every((download) => download.status !== "active")).toBe(true);
  });

  it("fences stale sessions through takeover, release and heartbeat-timeout recovery", async () => {
    let now = Date.UTC(2026, 7, 27, 10, 0, 0);
    const { store } = await fixture({ now: () => now, heartbeatTtlMs: 2_000 });
    const starting = await store.createSession(USER_A);
    const firstSession = starting.browserSessionId as string;
    await store.markReady(USER_A, firstSession);
    await store.takeOver(USER_A, firstSession);
    await store.heartbeat(USER_A, firstSession, "human");

    const releasing = await store.releaseTakeover(USER_A, firstSession);
    const secondSession = releasing.browserSessionId as string;
    expect(secondSession).not.toBe(firstSession);
    await expect(store.heartbeat(USER_A, firstSession, "human"))
      .rejects.toMatchObject({ code: "BROWSER_SESSION_MISMATCH" });
    await store.markReady(USER_A, secondSession);

    now += 2_001;
    const expired = await store.recoverExpired(USER_A);
    expect(expired.changed).toBe(true);
    expect(expired.state).toMatchObject({
      lifecycle: "recovering",
      controller: "none",
      lastRecoveryReason: "heartbeat_timeout",
      recoveryAttempt: 2,
    });
    expect(expired.state.browserSessionId).not.toBe(secondSession);
  });

  it("fails closed on corrupt state and symlinked profile roots", async () => {
    const { root, store } = await fixture();
    const rootsA = await store.roots(USER_A);
    await store.load(USER_A);
    await writeFile(rootsA.stateFile, "{broken-json}\n", "utf8");
    await chmod(rootsA.stateFile, 0o600);
    await expect(store.load(USER_A)).rejects.toBeInstanceOf(StorageCorruptionError);

    await rm(rootsA.profile, { recursive: true, force: true });
    const outside = path.join(root, "outside-profile");
    await mkdir(outside);
    await symlink(outside, rootsA.profile);
    await expect(store.roots(USER_A)).rejects.toMatchObject({ code: "WORKER_SYMLINK_REJECTED" });
  });
});

describe("BrowserGatewayTokenService", () => {
  it("binds short-lived capabilities to installation, user, browser session and local auth session", () => {
    let now = 1_777_000_000_000;
    const service = new BrowserGatewayTokenService({
      secret: "synthetic-browser-gateway-secret-0000000000000001",
      now: () => now,
    });
    const browserSessionId = "0198b9f0-6631-7000-8000-000000000399";
    const threadId = "0198b9f0-6631-7000-8000-000000000398";
    const authSessionId = "opaque-local-auth-session-00000000000000000001";
    const token = service.issue({
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId,
      capabilities: ["view", "heartbeat"],
      ttlMs: 2_000,
    });
    expect(token).not.toContain(authSessionId);
    expect(service.verify(token, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId,
      requiredCapability: "heartbeat",
    })).toMatchObject({ userId: USER_A, browserSessionId });
    expect(() => service.verify(token, {
      installationId: "browser-lab",
      userId: USER_B,
      threadId,
      browserSessionId,
      authSessionId,
      requiredCapability: "view",
    })).toThrow(BrowserGatewayTokenError);
    expect(() => service.verify(token, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId: "different-local-auth-session-000000000000000001",
      requiredCapability: "heartbeat",
    })).toThrowError(expect.objectContaining({ code: "BROWSER_GATEWAY_BINDING_INVALID" }));
    expect(() => service.verify(token, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId,
      requiredCapability: "takeover",
    })).toThrowError(expect.objectContaining({ code: "BROWSER_GATEWAY_BINDING_INVALID" }));
    expect(() => service.verify(`${token.slice(0, -1)}x`, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId,
      requiredCapability: "view",
    })).toThrow(BrowserGatewayTokenError);
    expect(() => service.verify(token, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId: "0198b9f0-6631-7000-8000-000000000397",
      browserSessionId,
      authSessionId,
      requiredCapability: "view",
    })).toThrowError(expect.objectContaining({ code: "BROWSER_GATEWAY_BINDING_INVALID" }));
    now += 2_001;
    expect(() => service.verify(token, {
      installationId: "browser-lab",
      userId: USER_A,
      threadId,
      browserSessionId,
      authSessionId,
      requiredCapability: "view",
    })).toThrowError(expect.objectContaining({ code: "BROWSER_GATEWAY_TOKEN_EXPIRED" }));
  });
});

describe("BrowserRuntimeRegistry", () => {
  it("projects real downloads through a rotated takeover session without losing ownership", async () => {
    const { store } = await fixture();
    const factory = new FakeBrowserFactory();
    const registry = new BrowserRuntimeRegistry({ store, factory });
    await registry.start(USER_A);
    const projection = factory.contexts[0]!.downloadProjection as NonNullable<BrowserRuntimeContext["downloadProjection"]>;
    const download = await projection.start("report.pdf");
    await registry.takeOver(USER_A);
    const beforeRelease = registry.get(USER_A)?.browserSessionId;
    await registry.releaseTakeover(USER_A);
    expect(registry.get(USER_A)?.browserSessionId).not.toBe(beforeRelease);
    await projection.finish(download.id, { status: "complete", sizeBytes: 42 });
    await expect(registry.state(USER_A)).resolves.toMatchObject({
      downloads: [expect.objectContaining({
        id: download.id,
        fileName: "report.pdf",
        status: "complete",
        sizeBytes: 42,
      })],
    });
    await registry.close();
  });

  it("recovers expired human and agent control before accepting direct actions", async () => {
    let now = Date.UTC(2026, 7, 27, 12, 0, 0);
    const { store } = await fixture({ now: () => now, heartbeatTtlMs: 1_000 });
    const factory = new FakeBrowserFactory();
    const registry = new BrowserRuntimeRegistry({ store, factory });
    const initial = await registry.start(USER_A);
    await registry.takeOver(USER_A);
    now += 1_001;
    await expect(registry.navigate(USER_A, THREAD_A, "https://expired.test"))
      .rejects.toThrow("requires an active human takeover");
    const recoveredHuman = registry.get(USER_A);
    expect(recoveredHuman?.browserSessionId).not.toBe(initial.browserSessionId);
    expect(await registry.state(USER_A)).toMatchObject({ lifecycle: "ready", controller: "agent" });

    const agentSession = recoveredHuman?.browserSessionId;
    now += 1_001;
    await expect(registry.agentNavigate(USER_A, THREAD_A, "https://agent.test")).resolves.toBeUndefined();
    expect(registry.get(USER_A)?.browserSessionId).not.toBe(agentSession);
    await registry.close();
  });

  it("replaces an unhealthy runtime and fences its browser session on the next service start", async () => {
    const { store } = await fixture();
    const factory = new FakeBrowserFactory();
    const registry = new BrowserRuntimeRegistry({ store, factory });
    const initial = await registry.start(USER_A);
    factory.runtimes[0].stopped = true;
    const recovered = await registry.start(USER_A);
    expect(factory.runtimes).toHaveLength(2);
    expect(recovered.browserSessionId).not.toBe(initial.browserSessionId);
    await expect(registry.agentNavigate(USER_A, THREAD_A, "https://recovered.test")).resolves.toBeUndefined();
    expect(factory.runtimes[1].navigations).toEqual([`agent:${THREAD_A}:https://recovered.test`]);
    await registry.close();
  });

  it("forces a fresh private process even when a stalled runtime still reports healthy", async () => {
    const { store } = await fixture();
    const factory = new FakeBrowserFactory();
    const registry = new BrowserRuntimeRegistry({ store, factory });
    const initial = await registry.start(USER_A);
    const other = await registry.start(USER_B);

    const recovered = await registry.restart(USER_A);

    expect(factory.runtimes).toHaveLength(3);
    expect(factory.runtimes[0]?.stopped).toBe(true);
    expect(factory.runtimes[1]?.stopped).toBe(false);
    expect(recovered.browserSessionId).not.toBe(initial.browserSessionId);
    expect(registry.get(USER_B)?.browserSessionId).toBe(other.browserSessionId);
    expect(recovered.roots.profile).toBe(initial.roots.profile);
    await registry.close();
  });

  it("keeps runtimes exclusive per user and recovers durable state after process restart", async () => {
    const { store } = await fixture();
    const firstFactory = new FakeBrowserFactory();
    const first = new BrowserRuntimeRegistry({ store, factory: firstFactory });
    const [handleA, handleB] = await Promise.all([first.start(USER_A), first.start(USER_B)]);
    expect(handleA.roots.profile).not.toBe(handleB.roots.profile);
    expect(firstFactory.runtimes[0]).not.toBe(firstFactory.runtimes[1]);
    await first.takeOver(USER_A);
    expect((await first.state(USER_A)).controller).toBe("human");
    expect((await first.state(USER_B)).controller).toBe("agent");

    const secondFactory = new FakeBrowserFactory();
    const restarted = new BrowserRuntimeRegistry({ store, factory: secondFactory });
    const recovered = await restarted.start(USER_A);
    expect(recovered.browserSessionId).not.toBe(handleA.browserSessionId);
    expect(secondFactory.contexts[0].recovering).toBe(true);
    expect((await restarted.state(USER_A))).toMatchObject({
      lifecycle: "ready",
      controller: "agent",
      lastRecoveryReason: "process_restart",
    });
    await expect(first.heartbeat(USER_A, "human"))
      .rejects.toMatchObject({ code: "BROWSER_SESSION_MISMATCH" });
    await expect(first.health(USER_A)).resolves.toMatchObject({
      healthy: false,
      runtime: { healthy: false },
    });
    await restarted.close();
  });

  it("applies bounded start backpressure without sharing a queued runtime", async () => {
    const { store } = await fixture();
    let releaseStart: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let enteredResolve: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const factory = new FakeBrowserFactory(barrier, () => enteredResolve?.());
    const registry = new BrowserRuntimeRegistry({
      store,
      factory,
      maxConcurrentStarts: 1,
      maxPendingStarts: 0,
      backpressureRetryAfterMs: 250,
    });
    const first = registry.start(USER_A);
    await entered;
    await expect(registry.start(USER_B)).rejects.toEqual(
      expect.objectContaining({
        code: "BROWSER_START_BACKPRESSURE",
        retryAfterMs: 250,
      } satisfies Partial<BrowserRegistryBackpressureError>),
    );
    (releaseStart as (() => void) | null)?.();
    await first;
    expect(factory.runtimes).toHaveLength(1);
    await registry.close();
  });

  it("allows viewing while ready but fences navigation and input behind human takeover", async () => {
    const { store } = await fixture();
    const factory = new FakeBrowserFactory();
    const registry = new BrowserRuntimeRegistry({ store, factory });
    await registry.start(USER_A);
    await expect(registry.captureFrame(USER_A, THREAD_A)).resolves.toMatchObject({
      schemaVersion: 1,
      mediaType: "image/png",
    });
    await expect(registry.navigate(USER_A, THREAD_A, "https://example.test"))
      .rejects.toThrow("requires an active human takeover");
    await registry.takeOver(USER_A);
    await expect(registry.agentCaptureFrame(USER_A, THREAD_A)).rejects.toThrow("unavailable during human takeover");
    await expect(registry.readPage(USER_A, THREAD_A)).rejects.toThrow("unavailable during human takeover");
    await expect(registry.listTabs(USER_A, THREAD_A)).rejects.toThrow("unavailable during human takeover");
    await expect(registry.listDownloads(USER_A, THREAD_A)).rejects.toThrow("unavailable during human takeover");
    await expect(registry.agentNavigate(USER_A, THREAD_A, "https://example.test"))
      .rejects.toThrow("unavailable during human takeover");
    await expect(registry.agentScroll(USER_A, THREAD_A, 0, 100))
      .rejects.toThrow("unavailable during human takeover");
    await expect(registry.agentClick(USER_A, THREAD_A, "button"))
      .rejects.toThrow("unavailable during human takeover");
    await expect(registry.agentType(USER_A, THREAD_A, "input", "secret", true))
      .rejects.toThrow("unavailable during human takeover");
    await registry.navigate(USER_A, THREAD_A, "https://example.test");
    await registry.dispatchInput(USER_A, THREAD_B, {
      kind: "key",
      event: "keyDown",
      key: "A",
    });
    expect(factory.runtimes[0].navigations).toEqual([`${THREAD_A}:https://example.test`]);
    expect(factory.runtimes[0].inputs).toEqual([
      expect.objectContaining({ threadId: THREAD_B }),
    ]);
    await registry.close();
  });
});
