import { availableParallelism } from "node:os";
import type {
  BrowserPersistentState,
  BrowserRuntimeContext,
  BrowserRuntimeFactory,
  BrowserRuntimeHandle,
  BrowserFrame,
  BrowserInputCommand,
  InteractiveManagedBrowserRuntime,
  ManagedBrowserRuntime,
} from "@/runtime/browser/types";
import { BrowserSessionStore } from "@/runtime/browser/state-store";
import { validateWorkerUserId } from "@/runtime/workers/provisioner";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validateBrowserThreadId(threadId: string) {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new Error("Browser threadId must be a canonical lowercase UUID.");
  }
}

export class BrowserRegistryBackpressureError extends Error {
  readonly code = "BROWSER_START_BACKPRESSURE";
  readonly retryable = true;

  constructor(readonly retryAfterMs: number) {
    super("Browser start capacity is saturated; retry later.");
    this.name = "BrowserRegistryBackpressureError";
  }
}

class StartGate {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;

  constructor(
    private readonly concurrency: number,
    private readonly maxPending: number,
    private readonly retryAfterMs: number,
  ) {}

  acquire() {
    if (this.closed) return Promise.reject(new Error("Browser registry is closed."));
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(this.release());
    }
    if (this.waiters.length >= this.maxPending) {
      return Promise.reject(new BrowserRegistryBackpressureError(this.retryAfterMs));
    }
    return new Promise<() => void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close() {
    this.closed = true;
    const error = new Error("Browser registry is closed.");
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next.resolve(this.release());
      else this.active -= 1;
    };
  }
}

type Entry = {
  runtime: ManagedBrowserRuntime | null;
  handle: BrowserRuntimeHandle | null;
  startPromise: Promise<BrowserRuntimeHandle> | null;
  stopPromise: Promise<boolean> | null;
};

function positiveInteger(name: string, value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value < 1)) {
    throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}.`);
  }
  return value;
}

function frozenHandle(context: BrowserRuntimeContext): BrowserRuntimeHandle {
  return Object.freeze({
    installationId: context.installationId,
    userId: context.userId,
    browserSessionId: context.browserSessionId,
    generation: context.generation,
    roots: context.roots,
  });
}

export type BrowserRuntimeRegistryOptions = {
  store: BrowserSessionStore;
  factory: BrowserRuntimeFactory;
  maxConcurrentStarts?: number;
  maxPendingStarts?: number;
  backpressureRetryAfterMs?: number;
};

/** Process-local runtime ownership; durable browser state lives in BrowserSessionStore. */
export class BrowserRuntimeRegistry {
  readonly store: BrowserSessionStore;
  private readonly factory: BrowserRuntimeFactory;
  private readonly starts: StartGate;
  private readonly entries = new Map<string, Entry>();
  private readonly owners = new WeakMap<object, string>();
  private closed = false;

  constructor(options: BrowserRuntimeRegistryOptions) {
    this.store = options.store;
    this.factory = options.factory;
    this.starts = new StartGate(
      positiveInteger(
        "maxConcurrentStarts",
        options.maxConcurrentStarts ?? Math.max(1, Math.min(4, availableParallelism())),
      ),
      positiveInteger("maxPendingStarts", options.maxPendingStarts ?? 128, true),
      positiveInteger("backpressureRetryAfterMs", options.backpressureRetryAfterMs ?? 1_000),
    );
  }

  async start(userId: string): Promise<BrowserRuntimeHandle> {
    validateWorkerUserId(userId);
    if (this.closed) throw new Error("Browser registry is closed.");
    const entry = this.entries.get(userId) ?? {
      runtime: null,
      handle: null,
      startPromise: null,
      stopPromise: null,
    };
    this.entries.set(userId, entry);
    if (entry.stopPromise) {
      await entry.stopPromise;
      return this.start(userId);
    }
    if (entry.handle) return entry.handle;
    if (entry.startPromise) return entry.startPromise;
    const promise = this.startEntry(userId, entry);
    entry.startPromise = promise;
    void promise.finally(() => {
      if (entry.startPromise === promise) entry.startPromise = null;
    }).catch(() => undefined);
    return promise;
  }

  get(userId: string) {
    validateWorkerUserId(userId);
    return this.entries.get(userId)?.handle ?? null;
  }

  async state(userId: string) {
    return this.store.load(userId);
  }

  async heartbeat(userId: string, controller: "agent" | "human") {
    const handle = this.requireHandle(userId);
    return this.store.heartbeat(userId, handle.browserSessionId, controller);
  }

  async takeOver(userId: string) {
    const entry = this.requireEntry(userId);
    const handle = entry.handle as BrowserRuntimeHandle;
    const state = await this.store.takeOver(userId, handle.browserSessionId);
    try {
      await (entry.runtime as ManagedBrowserRuntime).takeOver();
      return state;
    } catch (error) {
      await this.store.markDegraded(userId, handle.browserSessionId);
      throw error;
    }
  }

  async releaseTakeover(userId: string) {
    const entry = this.requireEntry(userId);
    const handle = entry.handle as BrowserRuntimeHandle;
    const recovering = await this.store.releaseTakeover(userId, handle.browserSessionId);
    const recoverySessionId = recovering.browserSessionId as string;
    try {
      await (entry.runtime as ManagedBrowserRuntime).releaseTakeover();
      const ready = await this.store.markReady(userId, recoverySessionId);
      entry.handle = frozenHandle(await this.context(userId, ready, true));
      return ready;
    } catch (error) {
      await this.store.markDegraded(userId, recoverySessionId);
      throw error;
    }
  }

  async recoverExpired(userId: string) {
    const entry = this.requireEntry(userId);
    const result = await this.store.recoverExpired(userId);
    if (!result.changed) return result.state;
    const recoverySessionId = result.state.browserSessionId as string;
    try {
      await (entry.runtime as ManagedBrowserRuntime).releaseTakeover();
      const ready = await this.store.markReady(userId, recoverySessionId);
      entry.handle = frozenHandle(await this.context(userId, ready, true));
      return ready;
    } catch (error) {
      await this.store.markDegraded(userId, recoverySessionId);
      throw error;
    }
  }

  async health(userId: string) {
    const entry = this.entries.get(userId);
    let state = await this.store.load(userId);
    if (!entry?.runtime || !entry.handle) return { healthy: false, state, runtime: null };
    if (state.browserSessionId !== entry.handle.browserSessionId) {
      return {
        healthy: false,
        state,
        runtime: { healthy: false, detail: "Runtime handle is fenced by a newer browser session." },
      };
    }
    try {
      if (state.heartbeatExpiresAt && Date.parse(state.heartbeatExpiresAt) <= Date.now()) {
        state = await this.recoverExpired(userId);
      }
      const health = await entry.runtime.health();
      if (health.healthy && state.lifecycle === "ready" && state.controller === "agent") {
        state = await this.store.heartbeat(userId, entry.handle.browserSessionId, "agent");
      }
      return { healthy: health.healthy && state.lifecycle !== "degraded", state, runtime: health };
    } catch {
      await this.store.markDegraded(userId, entry.handle.browserSessionId);
      return { healthy: false, state: await this.store.load(userId), runtime: null };
    }
  }

  async captureFrame(userId: string, threadId: string): Promise<BrowserFrame> {
    validateBrowserThreadId(threadId);
    const runtime = this.requireInteractiveRuntime(userId);
    const state = await this.store.load(userId);
    this.assertCurrentSession(userId, state);
    if (state.lifecycle !== "ready" && state.lifecycle !== "human-control") {
      throw new Error("Browser viewer is unavailable in the current lifecycle state.");
    }
    return runtime.captureFrame(threadId);
  }

  async readPage(userId: string, threadId: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    return runtime.readPage(threadId);
  }

  async agentCaptureFrame(userId: string, threadId: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    return runtime.agentCaptureFrame(threadId);
  }

  async listTabs(userId: string, threadId: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    return runtime.listTabs(threadId);
  }

  async listDownloads(userId: string, threadId: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    return runtime.listDownloads(threadId);
  }

  async agentNavigate(userId: string, threadId: string, url: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    await runtime.agentNavigate(threadId, url);
  }

  async agentScroll(userId: string, threadId: string, deltaX: number, deltaY: number) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    await runtime.agentScroll(threadId, deltaX, deltaY);
  }

  async agentClick(userId: string, threadId: string, selector: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    await runtime.agentClick(threadId, selector);
  }

  async agentType(userId: string, threadId: string, selector: string, text: string, clear: boolean) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireAgentRuntime(userId);
    const state = await this.store.load(userId);
    this.assertAgentControl(userId, state);
    await runtime.agentType(threadId, selector, text, clear);
  }

  async navigate(userId: string, threadId: string, url: string) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireInteractiveRuntime(userId);
    const state = await this.store.load(userId);
    this.assertHumanControl(userId, state);
    await runtime.navigate(threadId, url);
  }

  async dispatchInput(userId: string, threadId: string, command: BrowserInputCommand) {
    validateBrowserThreadId(threadId);
    const runtime = this.requireInteractiveRuntime(userId);
    const state = await this.store.load(userId);
    this.assertHumanControl(userId, state);
    await runtime.dispatchInput(threadId, command);
  }

  async stop(userId: string) {
    validateWorkerUserId(userId);
    const entry = this.entries.get(userId);
    if (!entry) return false;
    if (entry.stopPromise) return entry.stopPromise;
    const promise = this.stopEntry(userId, entry);
    entry.stopPromise = promise;
    void promise.finally(() => {
      if (entry.stopPromise === promise) entry.stopPromise = null;
    }).catch(() => undefined);
    return promise;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.starts.close();
    await Promise.allSettled([...this.entries.keys()].map((userId) => this.stop(userId)));
  }

  private async startEntry(userId: string, entry: Entry) {
    const release = await this.starts.acquire();
    let runtime: ManagedBrowserRuntime | null = null;
    let session: BrowserPersistentState | null = null;
    try {
      if (this.closed) throw new Error("Browser registry is closed.");
      const existing = await this.store.load(userId);
      const recovering = existing.lifecycle !== "stopped";
      session = recovering
        ? await this.store.beginRecovery(
          userId,
          existing.browserSessionId as string,
          "process_restart",
        )
        : await this.store.createSession(userId);
      const context = await this.context(userId, session, recovering);
      runtime = await this.factory.create(context);
      if (!runtime || typeof runtime !== "object" || this.owners.has(runtime)) {
        throw new Error("Browser factory returned a reused or invalid runtime.");
      }
      this.owners.set(runtime, userId);
      entry.runtime = runtime;
      await runtime.start();
      const ready = await this.store.markReady(userId, context.browserSessionId);
      const readyContext = await this.context(userId, ready, recovering);
      entry.handle = frozenHandle(readyContext);
      return entry.handle;
    } catch (error) {
      if (session?.browserSessionId) {
        await this.store.markDegraded(userId, session.browserSessionId).catch(() => undefined);
      }
      if (runtime) await runtime.stop().catch(() => undefined);
      entry.runtime = null;
      entry.handle = null;
      throw error;
    } finally {
      release();
    }
  }

  private async stopEntry(userId: string, entry: Entry) {
    if (entry.startPromise) await entry.startPromise.catch(() => undefined);
    if (!entry.runtime || !entry.handle) return false;
    const { runtime, handle } = entry;
    try {
      await runtime.stop();
      await this.store.stop(userId, handle.browserSessionId, true);
      return true;
    } catch (error) {
      await this.store.markDegraded(userId, handle.browserSessionId).catch(() => undefined);
      throw error;
    } finally {
      entry.runtime = null;
      entry.handle = null;
    }
  }

  private requireEntry(userId: string) {
    const entry = this.entries.get(userId);
    if (!entry?.runtime || !entry.handle) throw new Error("Browser runtime is not running.");
    return entry;
  }

  private requireHandle(userId: string) {
    return this.requireEntry(userId).handle as BrowserRuntimeHandle;
  }

  private requireInteractiveRuntime(userId: string) {
    const runtime = this.requireEntry(userId).runtime as ManagedBrowserRuntime;
    if (!("captureFrame" in runtime) || typeof runtime.captureFrame !== "function" ||
      !("navigate" in runtime) || typeof runtime.navigate !== "function" ||
      !("dispatchInput" in runtime) || typeof runtime.dispatchInput !== "function") {
      throw new Error("Browser runtime does not provide the interactive viewer contract.");
    }
    return runtime as InteractiveManagedBrowserRuntime;
  }

  private requireAgentRuntime(userId: string) {
    const runtime = this.requireInteractiveRuntime(userId);
    if (
      !("readPage" in runtime) || typeof runtime.readPage !== "function" ||
      !("agentCaptureFrame" in runtime) || typeof runtime.agentCaptureFrame !== "function" ||
      !("listTabs" in runtime) || typeof runtime.listTabs !== "function" ||
      !("listDownloads" in runtime) || typeof runtime.listDownloads !== "function" ||
      !("agentNavigate" in runtime) || typeof runtime.agentNavigate !== "function" ||
      !("agentScroll" in runtime) || typeof runtime.agentScroll !== "function" ||
      !("agentClick" in runtime) || typeof runtime.agentClick !== "function" ||
      !("agentType" in runtime) || typeof runtime.agentType !== "function") {
      throw new Error("Browser runtime does not provide the closed agent tool contract.");
    }
    return runtime;
  }

  private assertCurrentSession(userId: string, state: BrowserPersistentState) {
    const handle = this.requireHandle(userId);
    if (state.browserSessionId !== handle.browserSessionId) {
      throw new Error("Browser runtime is fenced by a newer browser session.");
    }
  }

  private assertHumanControl(userId: string, state: BrowserPersistentState) {
    this.assertCurrentSession(userId, state);
    if (state.lifecycle !== "human-control" || state.controller !== "human") {
      throw new Error("Browser input requires an active human takeover.");
    }
  }

  private assertAgentControl(userId: string, state: BrowserPersistentState) {
    this.assertCurrentSession(userId, state);
    if (state.lifecycle !== "ready" || state.controller !== "agent") {
      throw new Error("Browser agent action is unavailable during human takeover or recovery.");
    }
  }

  private async context(userId: string, state: BrowserPersistentState, recovering: boolean): Promise<BrowserRuntimeContext> {
    if (!state.browserSessionId) throw new Error("Browser state does not have an active session.");
    return Object.freeze({
      installationId: this.store.config.installationId,
      userId,
      browserSessionId: state.browserSessionId,
      generation: state.generation,
      recovering,
      roots: await this.store.roots(userId),
    });
  }
}
