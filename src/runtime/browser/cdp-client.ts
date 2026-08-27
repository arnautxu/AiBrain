import WebSocket, { type RawData } from "ws";

export const PRIVATE_CDP_METHODS = [
  "Browser.close",
  "Browser.getVersion",
  "Browser.setDownloadBehavior",
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.insertText",
  "Network.enable",
  "Page.captureScreenshot",
  "Page.enable",
  "Page.navigate",
  "Target.activateTarget",
  "Target.createTarget",
  "Target.getTargets",
] as const;

export type PrivateCdpMethod = typeof PRIVATE_CDP_METHODS[number];

export class CdpClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "CdpClientError";
  }
}

type PendingCommand = {
  method: PrivateCdpMethod;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventListener = (params: unknown) => void;

export type PrivateCdpClientOptions = {
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxPendingCommands?: number;
  maxCommandBytes?: number;
  maxFrameBytes?: number;
  maxListenersPerEvent?: number;
};

function positiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CdpClientError("CDP_OPTIONS_INVALID", `${name} must be a positive safe integer.`);
  }
  return value;
}

function privateCdpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CdpClientError("CDP_ENDPOINT_INVALID", "CDP endpoint is not an absolute URL.");
  }
  if (
    parsed.protocol !== "ws:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/devtools\/(browser|page)\/[A-Za-z0-9._-]{1,256}$/u.test(parsed.pathname)
  ) {
    throw new CdpClientError(
      "CDP_ENDPOINT_NOT_PRIVATE",
      "CDP endpoint must be an uncredentialed loopback DevTools WebSocket.",
    );
  }
  return parsed.toString();
}

function rawDataBytes(data: RawData) {
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.reduce((total, part) => total + part.byteLength, 0);
}

function rawDataText(data: RawData) {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.concat(data).toString("utf8");
}

function safeProtocolMessage(value: unknown) {
  if (typeof value !== "string") return "CDP command failed.";
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 500) || "CDP command failed.";
}

export class PrivateCdpClient {
  private readonly socket: WebSocket;
  private readonly commandTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly maxPendingCommands: number;
  private readonly maxCommandBytes: number;
  private readonly maxFrameBytes: number;
  private readonly maxListenersPerEvent: number;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private nextId = 1;
  private closed = false;

  private constructor(socket: WebSocket, options: PrivateCdpClientOptions) {
    this.socket = socket;
    this.commandTimeoutMs = positiveInteger("commandTimeoutMs", options.commandTimeoutMs ?? 10_000);
    this.closeTimeoutMs = positiveInteger("closeTimeoutMs", options.closeTimeoutMs ?? 2_000);
    this.maxPendingCommands = positiveInteger("maxPendingCommands", options.maxPendingCommands ?? 64);
    this.maxCommandBytes = positiveInteger("maxCommandBytes", options.maxCommandBytes ?? 1_048_576);
    this.maxFrameBytes = positiveInteger("maxFrameBytes", options.maxFrameBytes ?? 32 * 1024 * 1024);
    this.maxListenersPerEvent = positiveInteger("maxListenersPerEvent", options.maxListenersPerEvent ?? 16);
    socket.on("message", (data, isBinary) => this.receive(data, isBinary));
    socket.on("close", () => this.failAll(new CdpClientError("CDP_CLOSED", "CDP connection closed.")));
    socket.on("error", (error) => this.failAll(new CdpClientError("CDP_SOCKET_ERROR", "CDP connection failed.", { cause: error })));
  }

  static async connect(endpoint: string, options: PrivateCdpClientOptions = {}) {
    const url = privateCdpUrl(endpoint);
    const connectTimeoutMs = positiveInteger("connectTimeoutMs", options.connectTimeoutMs ?? 5_000);
    return new Promise<PrivateCdpClient>((resolve, reject) => {
      const socket = new WebSocket(url, {
        handshakeTimeout: connectTimeoutMs,
        maxPayload: options.maxFrameBytes ?? 32 * 1024 * 1024,
        perMessageDeflate: false,
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new CdpClientError("CDP_CONNECT_TIMEOUT", "CDP connection timed out."));
      }, connectTimeoutMs);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new PrivateCdpClient(socket, options));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new CdpClientError("CDP_CONNECT_FAILED", "CDP connection failed.", { cause: error }));
      });
    });
  }

  get isOpen() {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  async send<Result = unknown>(method: PrivateCdpMethod, params: Record<string, unknown> = {}) {
    if (!PRIVATE_CDP_METHODS.includes(method)) {
      throw new CdpClientError("CDP_METHOD_REJECTED", "CDP method is not in the private adapter allowlist.");
    }
    if (!this.isOpen) throw new CdpClientError("CDP_CLOSED", "CDP connection is not open.");
    if (this.pending.size >= this.maxPendingCommands) {
      throw new CdpClientError("CDP_BACKPRESSURE", "CDP command capacity is saturated.");
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new CdpClientError("CDP_PARAMS_INVALID", "CDP params must be an object.");
    }
    const id = this.nextId;
    this.nextId += 1;
    if (!Number.isSafeInteger(this.nextId)) this.nextId = 1;
    let payload: string;
    try {
      payload = JSON.stringify({ id, method, params });
    } catch (error) {
      throw new CdpClientError("CDP_PARAMS_INVALID", "CDP params are not serializable.", { cause: error });
    }
    if (Buffer.byteLength(payload, "utf8") > this.maxCommandBytes) {
      throw new CdpClientError("CDP_COMMAND_TOO_LARGE", "CDP command exceeds the safe size limit.");
    }
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpClientError("CDP_COMMAND_TIMEOUT", `CDP command ${method} timed out.`));
      }, this.commandTimeoutMs);
      this.pending.set(id, {
        method,
        timer,
        resolve: (value) => resolve(value as Result),
        reject,
      });
      this.socket.send(payload, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(new CdpClientError("CDP_SEND_FAILED", "CDP command could not be sent.", { cause: error }));
      });
    });
  }

  on(method: string, listener: EventListener) {
    if (!/^([A-Za-z]+\.)+[A-Za-z]+$/u.test(method)) {
      throw new CdpClientError("CDP_EVENT_INVALID", "CDP event name is invalid.");
    }
    const current = this.listeners.get(method) ?? new Set<EventListener>();
    if (current.size >= this.maxListenersPerEvent) {
      throw new CdpClientError("CDP_LISTENER_BACKPRESSURE", "CDP event listener capacity is saturated.");
    }
    current.add(listener);
    this.listeners.set(method, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(method);
    };
  }

  waitForEvent<Result = unknown>(method: string, timeoutMs = this.commandTimeoutMs) {
    positiveInteger("eventTimeoutMs", timeoutMs);
    return new Promise<Result>((resolve, reject) => {
      let unsubscribe: () => void = () => undefined;
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new CdpClientError("CDP_EVENT_TIMEOUT", `CDP event ${method} timed out.`));
      }, timeoutMs);
      unsubscribe = this.on(method, (params) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params as Result);
      });
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new CdpClientError("CDP_CLOSED", "CDP client closed."));
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, this.closeTimeoutMs);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(1000, "client closing");
    });
  }

  private receive(data: RawData, isBinary: boolean) {
    if (isBinary || rawDataBytes(data) > this.maxFrameBytes) {
      this.protocolFailure("CDP frame is binary or exceeds the safe size limit.");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(rawDataText(data));
    } catch {
      this.protocolFailure("CDP frame is not valid JSON.");
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.protocolFailure("CDP frame is not an object.");
      return;
    }
    const record = message as Record<string, unknown>;
    if (Number.isSafeInteger(record.id)) {
      const pending = this.pending.get(record.id as number);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(record.id as number);
      if (record.error && typeof record.error === "object") {
        const error = record.error as Record<string, unknown>;
        pending.reject(new CdpClientError(
          "CDP_COMMAND_FAILED",
          `${pending.method} failed: ${safeProtocolMessage(error.message)}`,
        ));
      } else {
        pending.resolve(record.result ?? {});
      }
      return;
    }
    if (typeof record.method === "string") {
      for (const listener of this.listeners.get(record.method) ?? []) {
        try {
          listener(record.params ?? {});
        } catch {
          // One consumer cannot break protocol processing for other consumers.
        }
      }
      return;
    }
    this.protocolFailure("CDP frame is neither a response nor an event.");
  }

  private protocolFailure(message: string) {
    const error = new CdpClientError("CDP_PROTOCOL_ERROR", message);
    this.failAll(error);
    this.socket.close(1002, "protocol error");
  }

  private failAll(error: Error) {
    if (this.closed && this.pending.size === 0) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.socket.readyState === WebSocket.CLOSED) this.closed = true;
  }
}

export function normalizePrivateDevToolsWebSocket(endpoint: string, expectedPort: number) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new CdpClientError("CDP_ENDPOINT_INVALID", "DevTools WebSocket URL is invalid.");
  }
  if (
    parsed.protocol !== "ws:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    Number(parsed.port) !== expectedPort ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    !/^\/devtools\/(browser|page)\/[A-Za-z0-9._-]{1,256}$/u.test(parsed.pathname)
  ) {
    throw new CdpClientError("CDP_ENDPOINT_NOT_PRIVATE", "DevTools WebSocket binding is not private or expected.");
  }
  return `ws://127.0.0.1:${expectedPort}${parsed.pathname}`;
}
