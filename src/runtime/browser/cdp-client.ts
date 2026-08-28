import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";

export const PRIVATE_CDP_METHODS = [
  "Browser.close",
  "Browser.getVersion",
  "Browser.setDownloadBehavior",
  "DOM.focus",
  "DOM.describeNode",
  "DOM.getBoxModel",
  "DOM.getDocument",
  "DOM.querySelector",
  "DOM.scrollIntoViewIfNeeded",
  "Fetch.continueRequest",
  "Fetch.continueWithAuth",
  "Fetch.disable",
  "Fetch.enable",
  "Fetch.failRequest",
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.insertText",
  "Network.enable",
  "Page.captureScreenshot",
  "Page.enable",
  "Page.navigate",
  "Runtime.evaluate",
  "Target.activateTarget",
  "Target.attachToTarget",
  "Target.closeTarget",
  "Target.createTarget",
  "Target.detachFromTarget",
  "Target.getTargets",
  "Target.setDiscoverTargets",
] as const;

export type PrivateCdpMethod = typeof PRIVATE_CDP_METHODS[number];
export type CdpSessionScope = Readonly<{ sessionId?: string }>;

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
  sessionId: string | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventListener = (params: unknown) => void;

export type PrivateCdpClientOptions = {
  commandTimeoutMs?: number;
  maxPendingCommands?: number;
  maxCommandBytes?: number;
  maxFrameBytes?: number;
  maxListenersPerEvent?: number;
};

const EVENT_PATTERN = /^([A-Za-z]+\.)+[A-Za-z]+$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function positiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CdpClientError("CDP_OPTIONS_INVALID", `${name} must be a positive safe integer.`);
  }
  return value;
}

function sessionId(scope: CdpSessionScope = {}) {
  const value = scope.sessionId;
  if (value === undefined) return null;
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new CdpClientError("CDP_SESSION_INVALID", "CDP sessionId is invalid.");
  }
  return value;
}

function listenerKey(method: string, value: string | null) {
  return `${value ?? "<browser>"}\u0000${method}`;
}

function safeProtocolMessage(value: unknown) {
  if (typeof value !== "string") return "CDP command failed.";
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 500) || "CDP command failed.";
}

/**
 * Bounded Chrome DevTools Protocol client over --remote-debugging-pipe.
 * Chrome reads NUL-delimited JSON from child fd 3 and writes it to child fd 4.
 */
export class PrivateCdpClient {
  private readonly commandTimeoutMs: number;
  private readonly maxPendingCommands: number;
  private readonly maxCommandBytes: number;
  private readonly maxFrameBytes: number;
  private readonly maxListenersPerEvent: number;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private nextId = 1;
  private buffered = Buffer.alloc(0);
  private closed = false;

  private constructor(
    private readonly requestPipe: Writable,
    private readonly responsePipe: Readable,
    options: PrivateCdpClientOptions,
  ) {
    this.commandTimeoutMs = positiveInteger("commandTimeoutMs", options.commandTimeoutMs ?? 10_000);
    this.maxPendingCommands = positiveInteger("maxPendingCommands", options.maxPendingCommands ?? 64);
    this.maxCommandBytes = positiveInteger("maxCommandBytes", options.maxCommandBytes ?? 1_048_576);
    this.maxFrameBytes = positiveInteger("maxFrameBytes", options.maxFrameBytes ?? 32 * 1024 * 1024);
    this.maxListenersPerEvent = positiveInteger("maxListenersPerEvent", options.maxListenersPerEvent ?? 16);
    responsePipe.on("data", this.handleData);
    responsePipe.once("end", this.handleEnd);
    responsePipe.once("close", this.handleClose);
    responsePipe.once("error", this.handleResponseError);
    requestPipe.once("close", this.handleClose);
    requestPipe.once("error", this.handleRequestError);
  }

  static connect(
    requestPipe: Writable,
    responsePipe: Readable,
    options: PrivateCdpClientOptions = {},
  ) {
    if (!requestPipe || typeof requestPipe.write !== "function" ||
      !responsePipe || typeof responsePipe.on !== "function") {
      throw new CdpClientError("CDP_PIPE_INVALID", "Chrome CDP pipe streams are unavailable.");
    }
    return new PrivateCdpClient(requestPipe, responsePipe, options);
  }

  get isOpen() {
    return !this.closed && !this.requestPipe.destroyed && !this.responsePipe.destroyed;
  }

  async send<Result = unknown>(
    method: PrivateCdpMethod,
    params: Record<string, unknown> = {},
    scope: CdpSessionScope = {},
  ) {
    if (!PRIVATE_CDP_METHODS.includes(method)) {
      throw new CdpClientError("CDP_METHOD_REJECTED", "CDP method is not in the private adapter allowlist.");
    }
    if (!this.isOpen) throw new CdpClientError("CDP_CLOSED", "CDP pipe is not open.");
    if (this.pending.size >= this.maxPendingCommands) {
      throw new CdpClientError("CDP_BACKPRESSURE", "CDP command capacity is saturated.");
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new CdpClientError("CDP_PARAMS_INVALID", "CDP params must be an object.");
    }
    const scopedSessionId = sessionId(scope);
    const id = this.nextCommandId();
    let payload: string;
    try {
      payload = JSON.stringify({
        id,
        method,
        params,
        ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
      });
    } catch (error) {
      throw new CdpClientError("CDP_PARAMS_INVALID", "CDP params are not serializable.", { cause: error });
    }
    if (Buffer.byteLength(payload, "utf8") > this.maxCommandBytes) {
      throw new CdpClientError("CDP_COMMAND_TOO_LARGE", "CDP command exceeds the safe size limit.");
    }
    const frame = Buffer.from(`${payload}\u0000`, "utf8");
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpClientError("CDP_COMMAND_TIMEOUT", `CDP command ${method} timed out.`));
      }, this.commandTimeoutMs);
      this.pending.set(id, {
        method,
        sessionId: scopedSessionId,
        timer,
        resolve: (value) => resolve(value as Result),
        reject,
      });
      this.requestPipe.write(frame, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(new CdpClientError("CDP_SEND_FAILED", "CDP command could not be written to Chrome.", { cause: error }));
      });
    });
  }

  on(method: string, listener: EventListener, scope: CdpSessionScope = {}) {
    if (!EVENT_PATTERN.test(method)) {
      throw new CdpClientError("CDP_EVENT_INVALID", "CDP event name is invalid.");
    }
    const key = listenerKey(method, sessionId(scope));
    const current = this.listeners.get(key) ?? new Set<EventListener>();
    if (current.size >= this.maxListenersPerEvent) {
      throw new CdpClientError("CDP_LISTENER_BACKPRESSURE", "CDP event listener capacity is saturated.");
    }
    current.add(listener);
    this.listeners.set(key, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(key);
    };
  }

  waitForEvent<Result = unknown>(
    method: string,
    timeoutMs = this.commandTimeoutMs,
    scope: CdpSessionScope = {},
  ) {
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
      }, scope);
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.detachStreams();
    this.failAll(new CdpClientError("CDP_CLOSED", "CDP pipe closed."));
    this.buffered = Buffer.alloc(0);
    this.requestPipe.destroy();
    this.responsePipe.destroy();
  }

  private nextCommandId() {
    for (let attempts = 0; attempts < Number.MAX_SAFE_INTEGER; attempts += 1) {
      const id = this.nextId;
      this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
      if (!this.pending.has(id)) return id;
    }
    throw new CdpClientError("CDP_BACKPRESSURE", "CDP command identifiers are exhausted.");
  }

  private readonly handleData = (chunk: Buffer | string) => {
    if (this.closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    let offset = 0;
    while (offset < bytes.byteLength && !this.closed) {
      const separator = bytes.indexOf(0, offset);
      const end = separator === -1 ? bytes.byteLength : separator;
      const segment = bytes.subarray(offset, end);
      if (this.buffered.byteLength + segment.byteLength > this.maxFrameBytes) {
        this.protocolFailure("CDP pipe frame exceeds the safe size limit.");
        return;
      }
      if (segment.byteLength > 0) {
        this.buffered = this.buffered.byteLength === 0
          ? Buffer.from(segment)
          : Buffer.concat([this.buffered, segment]);
      }
      if (separator === -1) return;
      if (this.buffered.byteLength === 0) {
        this.protocolFailure("CDP pipe contains an empty frame.");
        return;
      }
      const frame = this.buffered;
      this.buffered = Buffer.alloc(0);
      this.receive(frame);
      offset = separator + 1;
    }
  };

  private readonly handleEnd = () => {
    if (this.buffered.byteLength > 0) {
      this.protocolFailure("CDP pipe ended with an incomplete frame.");
      return;
    }
    this.transportFailure(new CdpClientError("CDP_PIPE_EOF", "Chrome closed the CDP response pipe."));
  };

  private readonly handleClose = () => {
    this.transportFailure(new CdpClientError("CDP_CLOSED", "Chrome CDP pipe closed."));
  };

  private readonly handleResponseError = (error: Error) => {
    this.transportFailure(new CdpClientError("CDP_PIPE_READ_FAILED", "Chrome CDP response pipe failed.", { cause: error }));
  };

  private readonly handleRequestError = (error: Error) => {
    this.transportFailure(new CdpClientError("CDP_PIPE_WRITE_FAILED", "Chrome CDP request pipe failed.", { cause: error }));
  };

  private receive(frame: Buffer) {
    let message: unknown;
    try {
      message = JSON.parse(STRICT_UTF8.decode(frame));
    } catch {
      this.protocolFailure("CDP pipe frame is not strict UTF-8 JSON.");
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.protocolFailure("CDP pipe frame is not an object.");
      return;
    }
    const record = message as Record<string, unknown>;
    if (Number.isSafeInteger(record.id)) {
      const pending = this.pending.get(record.id as number);
      if (!pending) return;
      const receivedSessionId = record.sessionId === undefined
        ? null
        : typeof record.sessionId === "string" && SESSION_ID_PATTERN.test(record.sessionId)
          ? record.sessionId
          : undefined;
      if (receivedSessionId === undefined || receivedSessionId !== pending.sessionId) {
        this.protocolFailure("CDP response sessionId does not match its command.");
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(record.id as number);
      if (record.error !== undefined) {
        if (!record.error || typeof record.error !== "object" || Array.isArray(record.error)) {
          this.protocolFailure("CDP response error has an invalid shape.");
          return;
        }
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
    if (typeof record.method === "string" && EVENT_PATTERN.test(record.method)) {
      const receivedSessionId = record.sessionId === undefined
        ? null
        : typeof record.sessionId === "string" && SESSION_ID_PATTERN.test(record.sessionId)
          ? record.sessionId
          : undefined;
      if (receivedSessionId === undefined) {
        this.protocolFailure("CDP event sessionId is invalid.");
        return;
      }
      for (const listener of this.listeners.get(listenerKey(record.method, receivedSessionId)) ?? []) {
        try {
          listener(record.params ?? {});
        } catch {
          // One consumer cannot break protocol processing for other consumers.
        }
      }
      return;
    }
    this.protocolFailure("CDP pipe frame is neither a response nor an event.");
  }

  private protocolFailure(message: string) {
    this.transportFailure(new CdpClientError("CDP_PROTOCOL_ERROR", message));
  }

  private transportFailure(error: CdpClientError) {
    if (this.closed) return;
    this.closed = true;
    this.detachStreams();
    this.failAll(error);
    this.buffered = Buffer.alloc(0);
    this.requestPipe.destroy();
    this.responsePipe.destroy();
  }

  private detachStreams() {
    this.responsePipe.off("data", this.handleData);
    this.responsePipe.off("end", this.handleEnd);
    this.responsePipe.off("close", this.handleClose);
    this.responsePipe.off("error", this.handleResponseError);
    this.requestPipe.off("close", this.handleClose);
    this.requestPipe.off("error", this.handleRequestError);
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
