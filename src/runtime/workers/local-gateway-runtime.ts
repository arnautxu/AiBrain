import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { createInterface, type Interface } from "node:readline";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  JsonValue,
  TransportHealth,
} from "@/runtime/transport";
import {
  APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
  FileTransportEventJournal,
  WebSocketAppServerTransport,
  validateAppServerRequest,
} from "@/runtime/transport";
import type {
  WebSocketConnectOptions,
  WebSocketFactory,
  WebSocketLike,
} from "@/runtime/transport/websocket-types";
import type {
  ManagedWorkerRuntime,
  WorkerControllerHealth,
  WorkerLaunchContext,
  WorkerRuntimeFactory,
} from "@/runtime/workers/types";
import {
  defineVersionedSchema,
  expectIsoDate,
  expectOneOf,
  expectString,
  FileJournal,
  ResourceLockManager,
  type StorageSchema,
} from "@/storage";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_STDIO_LINE_BYTES = 8 * 1024 * 1024;
const CLIENT_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

type GatewayRequestRecord = {
  schemaVersion: 1;
  clientRequestId: string;
  canonicalHash: string;
  status: "accepted" | "completed";
  responseJson: string | null;
  occurredAt: string;
};

const gatewayRequestSchema = defineVersionedSchema<GatewayRequestRecord>({
  name: "GatewayRequestRecord",
  schemaVersion: 1,
  keys: ["clientRequestId", "canonicalHash", "status", "responseJson", "occurredAt"],
  parse(record, context) {
    const status = expectOneOf(record.status, ["accepted", "completed"] as const, context.at("status"));
    const responseJson = record.responseJson === null
      ? null
      : expectString(record.responseJson, context.at("responseJson"), { maxLength: MAX_FRAME_BYTES });
    if ((status === "accepted") !== (responseJson === null)) {
      context.at("responseJson").fail("accepted requests cannot contain a response and completed requests require one");
    }
    return {
      schemaVersion: 1,
      clientRequestId: expectString(record.clientRequestId, context.at("clientRequestId"), {
        pattern: CLIENT_REQUEST_ID,
      }),
      canonicalHash: expectString(record.canonicalHash, context.at("canonicalHash"), { pattern: SHA256 }),
      status,
      responseJson,
      occurredAt: expectIsoDate(record.occurredAt, context.at("occurredAt")),
    };
  },
});

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Worker gateway failure")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(token|secret|password)=\S+/giu, "$1=[REDACTED]");
}

function sameSecret(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function parseAppServerOutput(value: unknown): AppServerEvent["message"] {
  if (!isRecord(value)) throw new Error("Codex App Server emitted a non-object message.");
  if ((typeof value.id === "string" || typeof value.id === "number") && typeof value.method === "string") {
    return { kind: "rpc-request", rpc: value as never };
  }
  if (typeof value.method === "string" && value.id === undefined) {
    return { kind: "rpc-notification", rpc: value as never };
  }
  if (typeof value.id === "string" || typeof value.id === "number") {
    if ("result" in value) return { kind: "rpc-response", rpc: { id: value.id, result: asJsonValue(value.result) } };
    if (isRecord(value.error) && Number.isSafeInteger(value.error.code) && typeof value.error.message === "string") {
      return {
        kind: "rpc-response",
        rpc: {
          id: value.id,
          error: {
            code: value.error.code as number,
            message: value.error.message,
            ...(value.error.data === undefined ? {} : { data: asJsonValue(value.error.data) }),
          },
        },
      };
    }
  }
  throw new Error("Codex App Server emitted an unsupported JSON-RPC message.");
}

class GatewayRequestLedger {
  private readonly journal: FileJournal<GatewayRequestRecord>;

  constructor(filePath: string, lockManager: ResourceLockManager, private readonly now: () => number) {
    this.journal = new FileJournal({
      filePath,
      lockManager,
      payloadSchema: gatewayRequestSchema,
      now,
    });
  }

  async latest(clientRequestId: string) {
    const entries = await this.journal.read();
    return entries
      .map((entry) => entry.payload)
      .filter((entry) => entry.clientRequestId === clientRequestId)
      .at(-1) ?? null;
  }

  async accept(clientRequestId: string, canonicalHash: string) {
    const existing = await this.latest(clientRequestId);
    if (existing) {
      if (existing.canonicalHash !== canonicalHash) {
        throw new Error("clientRequestId was reused with a different payload.");
      }
      return { existing: true, record: existing };
    }
    const record: GatewayRequestRecord = {
      schemaVersion: 1,
      clientRequestId,
      canonicalHash,
      status: "accepted",
      responseJson: null,
      occurredAt: new Date(this.now()).toISOString(),
    };
    await this.journal.append(record);
    return { existing: false, record };
  }

  async complete(clientRequestId: string, response: unknown) {
    const existing = await this.latest(clientRequestId);
    if (!existing) throw new Error("Cannot complete an unknown gateway request.");
    if (existing.status === "completed") return existing;
    const responseJson = JSON.stringify(response);
    if (Buffer.byteLength(responseJson, "utf8") > MAX_FRAME_BYTES) {
      throw new Error("Codex response exceeds the gateway safety limit.");
    }
    const completed: GatewayRequestRecord = {
      ...existing,
      status: "completed",
      responseJson,
      occurredAt: new Date(this.now()).toISOString(),
    };
    await this.journal.append(completed);
    return completed;
  }
}

export type PrivateWorkerGatewayOptions = {
  context: WorkerLaunchContext;
  processFactory?: (context: WorkerLaunchContext) => ChildProcessWithoutNullStreams;
  now?: () => number;
};

/**
 * Loopback-only authenticated gateway for one employee worker.
 *
 * It owns exactly one Codex App Server stdio process. The Next.js runtime talks
 * to this boundary only through the versioned private WebSocket envelope.
 */
export class PrivateWorkerGateway {
  readonly context: WorkerLaunchContext;
  readonly token: string;
  readonly sessionId = randomUUID();
  endpoint: string | null = null;

  private readonly now: () => number;
  private readonly processFactory: NonNullable<PrivateWorkerGatewayOptions["processFactory"]>;
  private readonly locks: ResourceLockManager;
  private readonly events: FileTransportEventJournal;
  private readonly requests: GatewayRequestLedger;
  private server: HttpServer | null = null;
  private sockets: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private stopping = false;
  private state: WorkerControllerHealth["state"] = "stopped";
  private lastError: string | null = null;
  private messageChain = Promise.resolve();

  constructor(options: PrivateWorkerGatewayOptions) {
    this.context = options.context;
    this.now = options.now ?? Date.now;
    this.token = randomBytes(32).toString("base64url");
    this.locks = new ResourceLockManager({
      rootDirectory: path.join(options.context.transportAudit, "gateway-locks"),
    });
    this.events = new FileTransportEventJournal({
      filePath: path.join(options.context.transportAudit, "gateway-events.jsonl"),
      lockManager: this.locks,
    });
    this.requests = new GatewayRequestLedger(
      path.join(options.context.transportAudit, "gateway-requests.jsonl"),
      this.locks,
      this.now,
    );
    this.processFactory = options.processFactory ?? ((context) => spawn(
      process.env.CODEX_BIN?.trim() || "codex",
      ["app-server", "--stdio"],
      {
        cwd: context.workspace,
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PATH: process.env.PATH,
          LANG: process.env.LANG,
          LC_ALL: process.env.LC_ALL,
          LC_CTYPE: process.env.LC_CTYPE,
          TZ: process.env.TZ,
          SSL_CERT_FILE: process.env.SSL_CERT_FILE,
          SSL_CERT_DIR: process.env.SSL_CERT_DIR,
          NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
          ...context.environment,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    ));
  }

  async start() {
    if (this.state === "running") return;
    if (this.state === "starting") throw new Error("Worker gateway is already starting.");
    this.state = "starting";
    this.stopping = false;
    try {
      await this.events.verifyAndRepair();
      this.child = this.processFactory(this.context);
      this.lines = createInterface({ input: this.child.stdout });
      this.lines.on("line", (line) => {
        this.messageChain = this.messageChain
          .then(() => this.receiveAppServerLine(line))
          .catch((error: unknown) => this.fail(error));
      });
      this.child.stderr.resume();
      this.child.once("error", (error) => this.fail(error));
      this.child.once("exit", (code, signal) => {
        if (!this.stopping) this.fail(new Error(`Codex App Server exited (${code ?? signal ?? "unknown"}).`));
      });

      this.server = createServer((_, response) => {
        response.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        response.end("Not found");
      });
      this.sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
      this.server.on("upgrade", (request, socket, head) => {
        const expected = `Bearer ${this.token}`;
        const received = request.headers.authorization ?? "";
        const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (requestPath !== "/app-server" || !sameSecret(received, expected)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        this.sockets?.handleUpgrade(request, socket, head, (webSocket) => {
          this.sockets?.emit("connection", webSocket, request);
        });
      });
      this.sockets.on("connection", (socket) => this.attach(socket));
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.server?.once("error", onError);
        this.server?.listen(0, "127.0.0.1", () => {
          this.server?.off("error", onError);
          resolve();
        });
      });
      const address = this.server.address();
      if (!address || typeof address === "string") throw new Error("Worker gateway did not bind a TCP port.");
      this.endpoint = `ws://127.0.0.1:${address.port}/app-server`;
      this.state = "running";
      this.lastError = null;
    } catch (error) {
      this.state = "failed";
      this.lastError = safeError(error);
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async health(): Promise<WorkerControllerHealth> {
    return {
      healthy: this.state === "running" && Boolean(this.endpoint && this.child && this.server),
      state: this.state,
      ...(this.lastError ? { detail: this.lastError } : {}),
    };
  }

  async stop() {
    if (this.state === "stopped" || this.state === "stopping") return;
    this.stopping = true;
    this.state = "stopping";
    this.activeSocket?.close(1001, "Worker stopping");
    this.activeSocket = null;
    for (const client of this.sockets?.clients ?? []) client.close(1001, "Worker stopping");
    await new Promise<void>((resolve) => {
      if (!this.sockets) return resolve();
      this.sockets.close(() => resolve());
    });
    this.sockets = null;
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    this.lines?.close();
    this.lines = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000);
        timeout.unref?.();
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await this.messageChain.catch(() => undefined);
    this.endpoint = null;
    this.state = "stopped";
    this.stopping = false;
  }

  private attach(socket: WebSocket) {
    this.activeSocket?.close(1012, "Replaced by a reconnected backend");
    this.activeSocket = socket;
    let resumed = false;
    socket.on("message", (data, isBinary) => {
      const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
      if (isBinary || frame.byteLength > MAX_FRAME_BYTES) {
        socket.close(1003, "Text frame required");
        return;
      }
      this.messageChain = this.messageChain
        .then(async () => {
          const value: unknown = JSON.parse(frame.toString("utf8"));
          if (!isRecord(value) || value.protocolVersion !== APP_SERVER_TRANSPORT_PROTOCOL_VERSION) {
            throw new Error("Unsupported worker gateway protocol.");
          }
          if (!resumed) {
            if (value.type !== "resume") throw new Error("First worker frame must be resume.");
            resumed = true;
            await this.resume(socket, value.afterEventId, value.afterSequence);
            return;
          }
          await this.handleClientFrame(socket, value);
        })
        .catch(() => socket.close(1002, "Protocol error"));
    });
    socket.on("close", () => {
      if (this.activeSocket === socket) this.activeSocket = null;
    });
  }

  private send(socket: WebSocket, frame: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const serialized = JSON.stringify(frame);
    if (Buffer.byteLength(serialized, "utf8") > MAX_FRAME_BYTES) throw new Error("Gateway frame exceeds safety limit.");
    socket.send(serialized);
  }

  private async resume(socket: WebSocket, afterEventId: unknown, afterSequence: unknown) {
    const cursor = await this.events.loadCursor();
    let sequence = 0;
    if (afterEventId !== null || afterSequence !== null) {
      if (typeof afterEventId !== "string" || !Number.isSafeInteger(afterSequence) || (afterSequence as number) < 1) {
        throw new Error("Replay cursor is invalid.");
      }
      const matching = (await this.events.readEvents((afterSequence as number) - 1, 1))[0];
      if (!matching || matching.sequence !== afterSequence || matching.eventId !== afterEventId) {
        throw new Error("Replay cursor is not present in the worker journal.");
      }
      sequence = afterSequence as number;
    }
    if (cursor && sequence > cursor.sequence) throw new Error("Replay cursor is ahead of the worker journal.");
    this.send(socket, {
      protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
      type: "ready",
      sessionId: this.sessionId,
      replaySupported: true,
    });
    for (const event of await this.events.readEvents(sequence)) {
      this.send(socket, {
        protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
        type: "event",
        event,
      });
    }
  }

  private async handleClientFrame(socket: WebSocket, value: Record<string, unknown>) {
    if (value.type === "ping") {
      if (typeof value.nonce !== "string") throw new Error("Heartbeat nonce is invalid.");
      this.send(socket, {
        protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
        type: "pong",
        nonce: value.nonce,
        receivedAt: new Date(this.now()).toISOString(),
      });
      return;
    }
    if (value.type === "event-ack") {
      if (typeof value.eventId !== "string" || !Number.isSafeInteger(value.sequence)) {
        throw new Error("Event acknowledgement is invalid.");
      }
      return;
    }
    if (value.type !== "request") throw new Error("Unsupported client frame.");
    validateAppServerRequest(value.request);
    await this.acceptRequest(socket, value.request);
  }

  private async acceptRequest(socket: WebSocket, request: AppServerRequest) {
    const canonical = JSON.stringify(request);
    const accepted = await this.requests.accept(request.clientRequestId, sha256(canonical));
    if (accepted.existing && accepted.record.status === "accepted") {
      this.send(socket, {
        protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
        type: "rejected",
        clientRequestId: request.clientRequestId,
        error: {
          code: 40901,
          message: "The previous request outcome is uncertain; recover thread state before retrying.",
          retryable: false,
        },
      });
      return;
    }
    this.send(socket, {
      protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
      type: "accepted",
      clientRequestId: request.clientRequestId,
    });
    if (accepted.existing && accepted.record.responseJson && request.kind === "rpc-request") {
      await this.recordAppServerOutput(JSON.parse(accepted.record.responseJson));
      return;
    }
    if (accepted.existing) return;
    const child = this.child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error("Codex App Server input is unavailable.");
    }
    const output = request.rpc;
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(output)}\n`, (error) => error ? reject(error) : resolve());
    });
    if (request.kind !== "rpc-request") {
      await this.requests.complete(request.clientRequestId, { id: request.clientRequestId, result: null });
    }
  }

  private async receiveAppServerLine(line: string) {
    if (Buffer.byteLength(line, "utf8") > MAX_STDIO_LINE_BYTES) {
      throw new Error("Codex App Server line exceeds the safety limit.");
    }
    const value: unknown = JSON.parse(line);
    if (isRecord(value) && typeof value.id === "string" && ("result" in value || "error" in value)) {
      await this.requests.complete(value.id, value);
    }
    await this.recordAppServerOutput(value);
  }

  private async recordAppServerOutput(value: unknown) {
    const cursor = await this.events.loadCursor();
    const event: AppServerEvent = {
      eventId: randomUUID(),
      sequence: (cursor?.sequence ?? 0) + 1,
      occurredAt: new Date(this.now()).toISOString(),
      message: parseAppServerOutput(value),
    };
    await this.events.append(event);
    const socket = this.activeSocket;
    if (socket) {
      this.send(socket, {
        protocolVersion: APP_SERVER_TRANSPORT_PROTOCOL_VERSION,
        type: "event",
        event,
      });
    }
  }

  private fail(error: unknown) {
    this.lastError = safeError(error);
    this.state = "failed";
    this.activeSocket?.close(1011, "Worker runtime failure");
  }
}

export class NodeWebSocketFactory implements WebSocketFactory {
  readonly supportsAuthorizationHeaders = true;

  create(url: string, options: WebSocketConnectOptions): WebSocketLike {
    return new WebSocket(
      url,
      options.protocols ? [...options.protocols] : undefined,
      { headers: options.headers ? { ...options.headers } : undefined },
    ) as unknown as WebSocketLike;
  }
}

class DeferredAppServerTransport implements AppServerTransport {
  private inner: AppServerTransport | null = null;
  private closed = false;
  private resolveInner!: (transport: AppServerTransport) => void;
  private readonly innerReady = new Promise<AppServerTransport>((resolve) => {
    this.resolveInner = resolve;
  });

  configure(transport: AppServerTransport) {
    if (this.inner) throw new Error("Worker transport was already configured.");
    this.inner = transport;
    this.resolveInner(transport);
    if (this.closed) void transport.close();
  }

  private async ready() {
    if (this.closed && !this.inner) throw new Error("Worker transport is closed.");
    return this.inner ?? this.innerReady;
  }

  async connect() { return (await this.ready()).connect(); }
  async send(message: AppServerRequest) { return (await this.ready()).send(message); }
  async *events() { for await (const event of (await this.ready()).events()) yield event; }
  async health(): Promise<TransportHealth> {
    if (!this.inner) {
      return {
        healthy: false,
        state: this.closed ? "closed" : "idle",
        endpoint: "pending://worker-gateway",
        reconnectAttempt: 0,
        pendingRequests: 0,
        lastEventId: null,
        lastEventSequence: null,
        lastConnectedAt: null,
        lastMessageAt: null,
        lastHeartbeatAt: null,
        lastError: null,
      };
    }
    return this.inner.health();
  }
  async close() {
    this.closed = true;
    if (this.inner) await this.inner.close();
  }
}

export type LocalGatewayWorkerRuntimeFactoryOptions = {
  processFactory?: PrivateWorkerGatewayOptions["processFactory"];
  now?: () => number;
};

class LocalGatewayManagedRuntime implements ManagedWorkerRuntime {
  readonly transport = new DeferredAppServerTransport();
  private gateway: PrivateWorkerGateway | null = null;

  constructor(
    private readonly context: WorkerLaunchContext,
    private readonly options: LocalGatewayWorkerRuntimeFactoryOptions,
  ) {}

  async start() {
    if (this.gateway) return;
    const gateway = new PrivateWorkerGateway({
      context: this.context,
      processFactory: this.options.processFactory,
      now: this.options.now,
    });
    await gateway.start();
    if (!gateway.endpoint) throw new Error("Worker gateway endpoint is unavailable.");
    const clientLocks = new ResourceLockManager({
      rootDirectory: path.join(this.context.transportAudit, "client-locks"),
    });
    const journal = new FileTransportEventJournal({
      filePath: path.join(this.context.transportAudit, "client-events.jsonl"),
      lockManager: clientLocks,
    });
    this.transport.configure(new WebSocketAppServerTransport({
      endpoint: gateway.endpoint,
      socketFactory: new NodeWebSocketFactory(),
      auth: {
        placement: "authorization-header",
        credentialProvider: {
          async getCredential() {
            return { kind: "capability-token" as const, token: gateway.token };
          },
        },
      },
      journal,
    }));
    this.gateway = gateway;
  }

  async health() {
    return this.gateway?.health() ?? {
      healthy: false,
      state: "stopped" as const,
      detail: "Worker gateway has not started.",
    };
  }

  async stop() {
    const gateway = this.gateway;
    this.gateway = null;
    if (gateway) await gateway.stop();
  }
}

export class LocalGatewayWorkerRuntimeFactory implements WorkerRuntimeFactory {
  constructor(private readonly options: LocalGatewayWorkerRuntimeFactoryOptions = {}) {}

  create(context: WorkerLaunchContext): ManagedWorkerRuntime {
    return new LocalGatewayManagedRuntime(context, this.options);
  }
}
