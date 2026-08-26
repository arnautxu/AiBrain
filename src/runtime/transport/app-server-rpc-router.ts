import { randomUUID } from "node:crypto";
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
};

export type AppServerTurnHandlers = {
  onNotification(notification: ServerNotification): void | Promise<void>;
  onServerRequest(request: ServerRequest): JsonValue | Promise<JsonValue>;
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
  handlers: AppServerTurnHandlers;
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
  private closed = false;

  constructor(readonly transport: AppServerTransport) {}

  start() {
    if (this.closed) return Promise.reject(new Error("App Server router is closed."));
    if (!this.startPromise) {
      this.startPromise = this.transport.connect().then(() => {
        this.consumePromise = this.consume();
      });
    }
    return this.startPromise;
  }

  registerTurn(
    threadId: string,
    localTurnId: string,
    handlers: AppServerTurnHandlers,
  ): AppServerTurnRegistration {
    if (!threadId || !localTurnId || this.closed) throw new Error("Turn registration scope is invalid.");
    if (this.turns.has(threadId)) throw new Error("A thread already has an active turn.");
    const state: TurnRegistrationState = {
      threadId,
      localTurnId,
      runtimeTurnId: null,
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
        state.runtimeTurnId = turnId;
      },
      dispose: () => {
        if (this.turns.get(threadId) === state) this.turns.delete(threadId);
      },
    });
  }

  async request(rpc: ClientRequest, timeoutMs = 30_000) {
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
      reject(new Error(`App Server request timed out: ${rpc.method}.`));
    }, timeoutMs);
    timeout.unref?.();
    this.pending.set(rpc.id, { resolve, reject, timeout });
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
    for (const turn of this.turns.values()) turn.handlers.onFailure(error);
    this.turns.clear();
  }

  private async consume() {
    try {
      for await (const event of this.transport.events()) {
        await this.route(event);
        await this.transport.acknowledge?.(event);
      }
      if (!this.closed) throw new Error("App Server transport event stream closed unexpectedly.");
    } catch (error) {
      if (!this.closed) this.fail(safeError(error));
    }
  }

  private async route(event: AppServerEvent) {
    if (event.message.kind === "rpc-response") {
      const response = event.message.rpc;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      if ("error" in response) pending.reject(responseError(response));
      else pending.resolve(response.result);
      return;
    }

    if (event.message.kind === "rpc-notification") {
      const notification = event.message.rpc;
      const scope = eventScope(notification);
      const turn = scope ? this.turns.get(scope.threadId) : null;
      if (turn && scope?.turnId) {
        if (turn.runtimeTurnId && turn.runtimeTurnId !== scope.turnId) return;
        turn.runtimeTurnId ??= scope.turnId;
      }
      if (turn) await turn.handlers.onNotification(notification);
      return;
    }

    const request = event.message.rpc;
    const scope = eventScope(request);
    const turn = scope ? this.turns.get(scope.threadId) : null;
    if (turn && scope?.turnId) {
      if (turn.runtimeTurnId && turn.runtimeTurnId !== scope.turnId) return;
      turn.runtimeTurnId ??= scope.turnId;
    }
    const response: JsonRpcSuccess | JsonRpcFailure = turn
      ? await Promise.resolve(turn.handlers.onServerRequest(request)).then(
          (result) => ({ id: request.id, result }),
          (error: unknown) => ({ id: request.id, error: { code: -32603, message: safeError(error).message } }),
        )
      : {
          id: request.id,
          error: {
            code: -32602,
            message: "No active user/thread/turn route owns this server request.",
          },
        };
    await this.transport.send({
      clientRequestId: `server-response:${randomUUID()}`,
      kind: "rpc-response",
      rpc: response,
    });
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) turn.handlers.onFailure(error);
  }
}
