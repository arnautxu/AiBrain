import { createHash, randomUUID } from "node:crypto";
import type { ClientNotification } from "../../../contracts/codex/0.149.1/types/ClientNotification";
import type { ClientRequest } from "../../../contracts/codex/0.149.1/types/ClientRequest";
import type { ServerNotification } from "../../../contracts/codex/0.149.1/types/ServerNotification";
import type { ServerRequest } from "../../../contracts/codex/0.149.1/types/ServerRequest";
import type {
  AppServerEvent,
  AppServerTransport,
  JsonRpcFailure,
  JsonRpcSuccess,
  JsonValue,
} from "@/runtime/transport/contracts";

type PendingRequest = {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  beforeResolve?: (value: JsonValue, event: AppServerEvent) => void | Promise<void>;
};

export class AppServerRequestTimeoutError extends Error {
  constructor(
    readonly method: ClientRequest["method"],
    readonly requestId: string | number,
    readonly timeoutMs: number,
  ) {
    super(`App Server request timed out: ${method}.`);
    this.name = "AppServerRequestTimeoutError";
  }
}

export type AppServerTurnHandlers = {
  onNotification(notification: ServerNotification, event: AppServerEvent): void | Promise<void>;
  onServerRequest(request: ServerRequest, event: AppServerEvent): JsonValue | Promise<JsonValue>;
  onFailure(error: Error): void;
};

export type AppServerTurnRegistration = {
  readonly threadId: string;
  readonly localTurnId: string;
  bindRuntimeTurn(turnId: string): void;
  dispose(): void;
};

type TurnRegistrationState = {
  threadId: string;
  localTurnId: string;
  runtimeTurnId: string | null;
  runtimeTurnBinding: Promise<string | null>;
  resolveRuntimeTurnBinding: (turnId: string | null) => void;
  handlers: AppServerTurnHandlers;
};

type ReceivedTurnOwner = {
  threadId: string;
  state: TurnRegistrationState;
};

function safeError(error: unknown) {
  return new Error((error instanceof Error ? error.message : "App Server routing failed.")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(token|secret|password)=\S+/giu, "$1=[REDACTED]"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function eventScope(rpc: ServerNotification | ServerRequest) {
  const params: Record<string, unknown> | null = isRecord(rpc.params)
    ? rpc.params as unknown as Record<string, unknown>
    : null;
  if (!params || typeof params.threadId !== "string") return null;
  let turnId = typeof params.turnId === "string" ? params.turnId : null;
  if (!turnId && isRecord(params.turn) && typeof params.turn.id === "string") {
    turnId = params.turn.id;
  }
  return { threadId: params.threadId, turnId };
}

function serverResponseClientRequestId(event: AppServerEvent, request: ServerRequest) {
  const scope = eventScope(request);
  const scopeDigest = scope
    ? createHash("sha256").update(JSON.stringify([scope.threadId, scope.turnId])).digest("hex")
    : "unscoped";
  return `server-response:${event.eventId}:${scopeDigest}`;
}

function responseError(response: JsonRpcFailure) {
  const error = new Error(response.error.message) as Error & { code?: number; data?: JsonValue };
  error.code = response.error.code;
  if (response.error.data !== undefined) error.data = response.error.data;
  return error;
}

/**
 * Multiplexes one employee's hot App Server transport without mutable global
 * handlers. A worker may run different threads concurrently, while each
 * thread owns at most one active turn registration.
 */
export class AppServerRpcRouter {
  private readonly pending = new Map<string | number, PendingRequest>();
  private readonly turns = new Map<string, TurnRegistrationState>();
  private startPromise: Promise<void> | null = null;
  private consumePromise: Promise<void> | null = null;
  private readonly scopeChains = new Map<string, Promise<void>>();
  private readonly inFlightEvents = new Set<Promise<void>>();
  private readonly readyToAcknowledge = new Map<number, AppServerEvent>();
  private nextAcknowledgementSequence: number | null = null;
  private acknowledgementChain = Promise.resolve();
  private closed = false;
  private fatalError: Error | null = null;

  constructor(readonly transport: AppServerTransport) {}

  start() {
    if (this.closed) return Promise.reject(new Error("App Server router is closed."));
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (!this.startPromise) {
      this.startPromise = this.transport.connect().then(() => {
        this.consumePromise = this.consume();
      });
    }
    return this.startPromise.then(() => {
      if (this.fatalError) throw this.fatalError;
    });
  }

  get failed() {
    return this.fatalError !== null;
  }

  registerTurn(
    threadId: string,
    localTurnId: string,
    handlers: AppServerTurnHandlers,
  ): AppServerTurnRegistration {
    if (!threadId || !localTurnId || this.closed || this.fatalError) throw new Error("Turn registration scope is invalid.");
    if (this.turns.has(threadId)) throw new Error("A thread already has an active turn.");
    let resolveRuntimeTurnBinding!: (turnId: string | null) => void;
    const runtimeTurnBinding = new Promise<string | null>((resolve) => {
      resolveRuntimeTurnBinding = resolve;
    });
    const state: TurnRegistrationState = {
      threadId,
      localTurnId,
      runtimeTurnId: null,
      runtimeTurnBinding,
      resolveRuntimeTurnBinding,
      handlers,
    };
    this.turns.set(threadId, state);
    return Object.freeze({
      threadId,
      localTurnId,
      bindRuntimeTurn: (turnId: string) => {
        if (!turnId || this.turns.get(threadId) !== state) throw new Error("Turn registration is no longer active.");
        if (state.runtimeTurnId && state.runtimeTurnId !== turnId) {
          throw new Error("Turn registration cannot be rebound to another runtime turn.");
        }
        if (!state.runtimeTurnId) {
          state.runtimeTurnId = turnId;
          state.resolveRuntimeTurnBinding(turnId);
        }
      },
      dispose: () => {
        if (this.turns.get(threadId) === state) {
          this.turns.delete(threadId);
          state.resolveRuntimeTurnBinding(null);
        }
      },
    });
  }

  hasActiveTurn(threadId: string, localTurnId?: string) {
    const turn = this.turns.get(threadId);
    return Boolean(turn && (localTurnId === undefined || turn.localTurnId === localTurnId));
  }

  async request(
    rpc: ClientRequest,
    timeoutMs = 30_000,
    beforeResolve?: (value: JsonValue, event: AppServerEvent) => void | Promise<void>,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) {
      throw new Error("App Server request timeout is invalid.");
    }
    if (this.pending.has(rpc.id)) throw new Error("App Server request id is already pending.");
    await this.start();
    let resolve!: (value: JsonValue) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<JsonValue>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const timeout = setTimeout(() => {
      this.pending.delete(rpc.id);
      reject(new AppServerRequestTimeoutError(rpc.method, rpc.id, timeoutMs));
    }, timeoutMs);
    timeout.unref?.();
    this.pending.set(rpc.id, { resolve, reject, timeout, beforeResolve });
    try {
      await this.transport.send({
        clientRequestId: String(rpc.id),
        kind: "rpc-request",
        rpc,
      });
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(rpc.id);
      throw error;
    }
    return result;
  }

  async notify(rpc: ClientNotification, clientRequestId = `notification:${randomUUID()}`) {
    await this.start();
    await this.transport.send({ clientRequestId, kind: "rpc-notification", rpc });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("App Server router closed.");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) {
      turn.resolveRuntimeTurnBinding(null);
      turn.handlers.onFailure(error);
    }
    this.turns.clear();
  }

  private async consume() {
    try {
      for await (const event of this.transport.events()) {
        if (this.closed) break;
        const completed = this.dispatch(event);
        if (event.message.kind === "rpc-response") await completed;
        if (this.inFlightEvents.size >= 512) {
          await Promise.race(this.inFlightEvents);
        }
      }
      await Promise.all(this.inFlightEvents);
      if (!this.closed) throw new Error("App Server transport event stream closed unexpectedly.");
    } catch (error) {
      if (!this.closed) this.fail(safeError(error));
    }
  }

  private scopeKey(event: AppServerEvent) {
    if (event.message.kind === "rpc-response") return null;
    const scope = eventScope(event.message.rpc);
    return scope ? `${scope.threadId}:${scope.turnId ?? "thread"}` : null;
  }

  private dispatch(event: AppServerEvent) {
    this.nextAcknowledgementSequence ??= event.sequence;
    const key = this.scopeKey(event);
    const receivedTurnOwner = this.turnOwnerAtReceipt(event);
    const previous = key ? this.scopeChains.get(key) ?? Promise.resolve() : Promise.resolve();
    const routed = previous.then(() => this.route(event, receivedTurnOwner));
    if (key) {
      this.scopeChains.set(key, routed);
      void routed.finally(() => {
        if (this.scopeChains.get(key) === routed) this.scopeChains.delete(key);
      }).catch(() => undefined);
    }
    const completed = routed
      .then(() => this.queueAcknowledgement(event))
      .catch((error: unknown) => {
        if (!this.closed) this.fail(safeError(error));
      });
    this.inFlightEvents.add(completed);
    void completed.finally(() => this.inFlightEvents.delete(completed));
    return completed;
  }

  /**
   * Event routing can be delayed behind another event for the same runtime
   * turn. Capture the active registration when the event is received so a
   * delayed notification from a disposed turn can never attach itself to the
   * next local turn registered on the same thread.
   */
  private turnOwnerAtReceipt(event: AppServerEvent): ReceivedTurnOwner | null {
    if (event.message.kind === "rpc-response") return null;
    const scope = eventScope(event.message.rpc);
    if (!scope) return null;
    const state = this.turns.get(scope.threadId);
    return state ? { threadId: scope.threadId, state } : null;
  }

  private async queueAcknowledgement(event: AppServerEvent) {
    this.readyToAcknowledge.set(event.sequence, event);
    const flush = this.acknowledgementChain.then(async () => {
      while (this.nextAcknowledgementSequence !== null) {
        const next = this.readyToAcknowledge.get(this.nextAcknowledgementSequence);
        if (!next) break;
        await this.transport.acknowledge?.(next);
        this.readyToAcknowledge.delete(this.nextAcknowledgementSequence);
        this.nextAcknowledgementSequence += 1;
      }
    });
    this.acknowledgementChain = flush;
    await flush;
  }

  private async route(event: AppServerEvent, receivedTurnOwner: ReceivedTurnOwner | null) {
    if (event.message.kind === "rpc-response") {
      const response = event.message.rpc;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      if ("error" in response) pending.reject(responseError(response));
      else {
        try {
          await pending.beforeResolve?.(response.result, event);
          pending.resolve(response.result);
        } catch (error) {
          pending.reject(safeError(error));
          throw error;
        }
      }
      return;
    }

    if (event.message.kind === "rpc-notification") {
      const notification = event.message.rpc;
      const scope = eventScope(notification);
      const turn = scope && receivedTurnOwner?.threadId === scope.threadId &&
          this.turns.get(scope.threadId) === receivedTurnOwner.state
        ? receivedTurnOwner.state
        : null;
      if (turn && scope?.turnId) {
        const runtimeTurnId = turn.runtimeTurnId ?? await turn.runtimeTurnBinding;
        if (runtimeTurnId !== scope.turnId) return;
      }
      if (turn) await turn.handlers.onNotification(notification, event);
      return;
    }

    const request = event.message.rpc;
    const scope = eventScope(request);
    const turn = scope && receivedTurnOwner?.threadId === scope.threadId &&
        this.turns.get(scope.threadId) === receivedTurnOwner.state
      ? receivedTurnOwner.state
      : null;
    let turnScopeMismatch = false;
    if (turn && scope?.turnId) {
      const runtimeTurnId = turn.runtimeTurnId ?? await turn.runtimeTurnBinding;
      turnScopeMismatch = runtimeTurnId !== scope.turnId;
    }
    const response: JsonRpcSuccess | JsonRpcFailure = turn && !turnScopeMismatch
      ? await Promise.resolve(turn.handlers.onServerRequest(request, event)).then(
          (result) => ({ id: request.id, result }),
          (error: unknown) => ({ id: request.id, error: { code: -32603, message: safeError(error).message } }),
        )
      : {
          id: request.id,
          error: {
            code: -32602,
            message: turnScopeMismatch
              ? "The active thread route does not own this runtime turn."
              : "No active user/thread/turn route owns this server request.",
          },
        };
    await this.transport.send({
      clientRequestId: serverResponseClientRequestId(event, request),
      kind: "rpc-response",
      rpc: response,
    });
  }

  private fail(error: Error) {
    if (this.fatalError || this.closed) return;
    this.fatalError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) {
      turn.resolveRuntimeTurnBinding(null);
      turn.handlers.onFailure(error);
    }
    this.turns.clear();
  }
}
