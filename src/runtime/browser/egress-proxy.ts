import { Agent, createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  BrowserNetworkPolicy,
  BrowserNetworkPolicyError,
  isGlobalNetworkAddress,
} from "@/runtime/browser/network-policy";

const DEFAULT_MAX_HEADER_BYTES = 32 * 1_024;
const DEFAULT_MAX_CONNECTIONS = 64;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES_PER_EXCHANGE = 128 * 1_024 * 1_024;
const MAX_AUTHORITY_BYTES = 1_024;

const STATIC_HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export class BrowserEgressProxyError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BrowserEgressProxyError";
  }
}

export type BrowserPinnedConnection = Readonly<{
  address: string;
  family: 4 | 6;
  port: number;
  hostname: string;
  signal: AbortSignal;
}>;

export type BrowserPinnedConnector = (target: BrowserPinnedConnection) => Promise<Socket>;

export type BrowserEgressProxyOptions = Readonly<{
  networkPolicy?: BrowserNetworkPolicy;
  connect?: BrowserPinnedConnector;
  maxHeaderBytes?: number;
  maxConnections?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxBytesPerExchange?: number;
}>;

export type BrowserEgressProxyHealth = Readonly<{
  healthy: boolean;
  detail: string;
  activeClientConnections: number;
  activeUpstreamConnections: number;
}>;

type ResolvedTarget = Readonly<{
  hostname: string;
  address: string;
  family: 4 | 6;
  port: number;
}>;

function boundedInteger(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BrowserEgressProxyError(
      "BROWSER_PROXY_OPTIONS_INVALID",
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function defaultPinnedConnector(target: BrowserPinnedConnection) {
  return new Promise<Socket>((resolve, reject) => {
    if (target.signal.aborted) {
      reject(new BrowserEgressProxyError("BROWSER_PROXY_CONNECT_ABORTED", "Pinned connection was aborted."));
      return;
    }
    const socket = netConnect({
      host: target.address,
      family: target.family,
      port: target.port,
      allowHalfOpen: false,
    });
    const abort = () => socket.destroy(new BrowserEgressProxyError(
      "BROWSER_PROXY_CONNECT_ABORTED",
      "Pinned connection was aborted.",
    ));
    target.signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => {
      target.signal.removeEventListener("abort", abort);
      resolve(socket);
    });
    socket.once("error", (error) => {
      target.signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

function containsProxyCredentials(headers: IncomingHttpHeaders) {
  return headers["proxy-authorization"] !== undefined || headers["proxy-authenticate"] !== undefined;
}

function connectionHeaderNames(headers: IncomingHttpHeaders) {
  const values = headers.connection;
  const joined = Array.isArray(values) ? values.join(",") : values ?? "";
  return new Set(joined.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function safeForwardHeaders(headers: IncomingHttpHeaders, host: string) {
  const connectionNames = connectionHeaderNames(headers);
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (value === undefined || STATIC_HOP_BY_HOP_HEADERS.has(normalized) || connectionNames.has(normalized)) {
      continue;
    }
    result[normalized] = value;
  }
  result.host = host;
  result.connection = "close";
  return result;
}

function hasAmbiguousBodyFraming(request: IncomingMessage) {
  if (request.headers["content-length"] !== undefined && request.headers["transfer-encoding"] !== undefined) {
    return true;
  }
  let contentLengthCount = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "content-length") contentLengthCount += 1;
  }
  return contentLengthCount > 1;
}

function requestContentLength(request: IncomingMessage) {
  const value = request.headers["content-length"];
  if (value === undefined) return null;
  if (Array.isArray(value) || !/^(?:0|[1-9]\d*)$/u.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function normalizedHostHeader(url: URL) {
  const defaultPort = url.protocol === "http:" ? "80" : "443";
  const hostname = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  return url.port && url.port !== defaultPort ? `${hostname}:${url.port}` : hostname;
}

function responseText(response: ServerResponse, status: number, message: string) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "cache-control": "no-store",
    connection: "close",
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(message),
  });
  response.end(message);
}

function socketResponse(socket: Duplex, status: number, reason: string) {
  if (!socket.destroyed && socket.writable) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } else {
    socket.destroy();
  }
}

function proxyStatus(error: unknown) {
  if (error instanceof BrowserNetworkPolicyError) {
    return error.code === "BROWSER_NETWORK_DNS_BACKPRESSURE" ? 429 : 403;
  }
  if (error instanceof BrowserEgressProxyError && error.code === "BROWSER_PROXY_SATURATED") return 429;
  if (error instanceof BrowserEgressProxyError && error.code === "BROWSER_PROXY_CONNECT_TIMEOUT") return 504;
  return 502;
}

function connectReason(status: number) {
  if (status === 403) return "Forbidden";
  if (status === 429) return "Too Many Requests";
  if (status === 504) return "Gateway Timeout";
  return "Bad Gateway";
}

export class BrowserEgressProxy {
  private readonly networkPolicy: BrowserNetworkPolicy;
  private readonly connector: BrowserPinnedConnector;
  private readonly maxHeaderBytes: number;
  private readonly maxConnections: number;
  private readonly connectTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxBytesPerExchange: number;
  private readonly clientSockets = new Set<Socket>();
  private readonly upstreamSockets = new Set<Socket>();
  private server: Server | null = null;
  private proxyUrl: string | null = null;
  private lastFailure: string | null = null;
  private transition: Promise<void> = Promise.resolve();

  constructor(options: BrowserEgressProxyOptions = {}) {
    if (options.connect && process.env.NODE_ENV === "production") {
      throw new BrowserEgressProxyError(
        "BROWSER_PROXY_PRODUCTION_CONNECTOR_FORBIDDEN",
        "A custom browser proxy connector cannot be used in production.",
      );
    }
    this.networkPolicy = options.networkPolicy ?? new BrowserNetworkPolicy();
    this.connector = options.connect ?? defaultPinnedConnector;
    this.maxHeaderBytes = boundedInteger(
      "maxHeaderBytes",
      options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES,
      4_096,
      128 * 1_024,
    );
    this.maxConnections = boundedInteger(
      "maxConnections",
      options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      1,
      1_024,
    );
    this.connectTimeoutMs = boundedInteger(
      "connectTimeoutMs",
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      100,
      120_000,
    );
    this.idleTimeoutMs = boundedInteger(
      "idleTimeoutMs",
      options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      100,
      3_600_000,
    );
    this.requestTimeoutMs = boundedInteger(
      "requestTimeoutMs",
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      3_600_000,
    );
    this.maxBytesPerExchange = boundedInteger(
      "maxBytesPerExchange",
      options.maxBytesPerExchange ?? DEFAULT_MAX_BYTES_PER_EXCHANGE,
      1_024,
      1024 * 1_024 * 1_024,
    );
  }

  async start() {
    return this.serialize(async () => {
      if (this.server?.listening && this.proxyUrl) return this.proxyUrl;
      const server = createServer({
        maxHeaderSize: this.maxHeaderBytes,
        requestTimeout: this.requestTimeoutMs,
        headersTimeout: Math.min(this.requestTimeoutMs, 60_000),
        keepAliveTimeout: 1_000,
        connectionsCheckingInterval: Math.min(this.idleTimeoutMs, 30_000),
      });
      server.maxConnections = this.maxConnections;
      server.on("request", (request, response) => {
        void this.handleHttpRequest(request, response);
      });
      server.on("connect", (request, socket, head) => {
        void this.handleConnect(request, socket, head);
      });
      server.on("upgrade", (_request, socket) => {
        socketResponse(socket, 400, "Bad Request");
      });
      server.on("checkContinue", (_request, response) => {
        responseText(response, 417, "Expectation Failed");
      });
      server.on("checkExpectation", (_request, response) => {
        responseText(response, 417, "Expectation Failed");
      });
      server.on("connection", (socket) => this.trackClientSocket(socket));
      server.on("error", () => {
        if (this.server !== server) return;
        this.lastFailure = "listener-error";
        this.server = null;
        this.proxyUrl = null;
        for (const socket of [...this.clientSockets, ...this.upstreamSockets]) socket.destroy();
        server.close(() => undefined);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
        });
      } catch (error) {
        server.close();
        throw new BrowserEgressProxyError(
          "BROWSER_PROXY_LISTEN_FAILED",
          "Private browser egress proxy could not listen on loopback.",
          { cause: error },
        );
      }

      const address = server.address();
      if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        server.close();
        throw new BrowserEgressProxyError(
          "BROWSER_PROXY_LOOPBACK_REQUIRED",
          "Private browser egress proxy did not bind to IPv4 loopback.",
        );
      }
      this.server = server;
      this.proxyUrl = `http://127.0.0.1:${address.port}`;
      this.lastFailure = null;
      return this.proxyUrl;
    });
  }

  async stop() {
    await this.serialize(async () => {
      const server = this.server;
      this.server = null;
      this.proxyUrl = null;
      if (!server) return;
      for (const socket of [...this.clientSockets, ...this.upstreamSockets]) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.clientSockets.clear();
      this.upstreamSockets.clear();
    });
  }

  async health(): Promise<BrowserEgressProxyHealth> {
    const healthy = this.server?.listening === true && this.proxyUrl !== null;
    return Object.freeze({
      healthy,
      detail: healthy
        ? "private-loopback-proxy-ready"
        : this.lastFailure ?? "private-loopback-proxy-stopped",
      activeClientConnections: this.clientSockets.size,
      activeUpstreamConnections: this.upstreamSockets.size,
    });
  }

  private serialize<T>(operation: () => Promise<T>) {
    const result = this.transition.then(operation, operation);
    this.transition = result.then(() => undefined, () => undefined);
    return result;
  }

  private trackClientSocket(socket: Socket) {
    if (this.clientSockets.size >= this.maxConnections) {
      socket.destroy(new BrowserEgressProxyError("BROWSER_PROXY_SATURATED", "Browser proxy is saturated."));
      return;
    }
    this.clientSockets.add(socket);
    socket.setTimeout(this.idleTimeoutMs, () => socket.destroy());
    socket.once("close", () => this.clientSockets.delete(socket));
  }

  private trackUpstreamSocket(socket: Socket) {
    this.upstreamSockets.add(socket);
    socket.setTimeout(this.idleTimeoutMs, () => socket.destroy());
    socket.once("close", () => this.upstreamSockets.delete(socket));
  }

  private async resolveTarget(url: string, expectedProtocol: "http:" | "https:") {
    const decision = await this.networkPolicy.assertAllowed(url);
    const parsed = new URL(decision.url);
    if (parsed.protocol !== expectedProtocol || parsed.username || parsed.password || parsed.hash || !decision.hostname) {
      throw new BrowserEgressProxyError(
        "BROWSER_PROXY_TARGET_REJECTED",
        "Browser proxy target is invalid.",
      );
    }
    if (decision.addresses.length === 0 || decision.addresses.some((address) => !isGlobalNetworkAddress(address))) {
      throw new BrowserEgressProxyError(
        "BROWSER_PROXY_PIN_REQUIRED",
        "Browser proxy requires a globally routable pinned DNS result.",
      );
    }
    const address = decision.addresses[0];
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      throw new BrowserEgressProxyError("BROWSER_PROXY_PIN_INVALID", "Browser proxy DNS pin is invalid.");
    }
    const port = parsed.port ? Number(parsed.port) : expectedProtocol === "http:" ? 80 : 443;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new BrowserEgressProxyError("BROWSER_PROXY_PORT_INVALID", "Browser proxy target port is invalid.");
    }
    return Object.freeze({ hostname: decision.hostname, address, family, port }) satisfies ResolvedTarget;
  }

  private async openPinnedSocket(target: ResolvedTarget) {
    if (this.upstreamSockets.size >= this.maxConnections) {
      throw new BrowserEgressProxyError("BROWSER_PROXY_SATURATED", "Browser proxy is saturated.");
    }
    const controller = new AbortController();
    let settled = false;
    const timeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);
    const pending = Promise.resolve().then(() => this.connector({ ...target, signal: controller.signal }));
    try {
      const socket = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new BrowserEgressProxyError(
            "BROWSER_PROXY_CONNECT_TIMEOUT",
            "Pinned connection timed out.",
          )), { once: true });
        }),
      ]);
      if (!(socket instanceof Object) || typeof socket.destroy !== "function" || socket.destroyed) {
        throw new BrowserEgressProxyError("BROWSER_PROXY_CONNECT_INVALID", "Pinned connector returned no live socket.");
      }
      this.trackUpstreamSocket(socket);
      settled = true;
      return socket;
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof BrowserEgressProxyError)) {
        throw new BrowserEgressProxyError(
          "BROWSER_PROXY_CONNECT_TIMEOUT",
          "Pinned connection timed out.",
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (!settled) {
        void pending.then((socket) => socket.destroy()).catch(() => undefined);
      }
    }
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      if (containsProxyCredentials(request.headers)) {
        responseText(response, 403, "Proxy credentials are forbidden.");
        return;
      }
      if (hasAmbiguousBodyFraming(request)) {
        responseText(response, 400, "Ambiguous request framing is forbidden.");
        return;
      }
      const contentLength = requestContentLength(request);
      if (Number.isNaN(contentLength) || (contentLength !== null && contentLength > this.maxBytesPerExchange)) {
        responseText(response, 413, "Request body exceeds the browser proxy limit.");
        return;
      }
      if (!request.url || Buffer.byteLength(request.url, "utf8") > this.maxHeaderBytes) {
        responseText(response, 400, "Absolute proxy URL is required.");
        return;
      }
      const decision = await this.networkPolicy.assertAllowed(request.url);
      const parsed = new URL(decision.url);
      if (parsed.protocol !== "http:" || parsed.hash || parsed.username || parsed.password || !decision.hostname) {
        responseText(response, 403, "Only credential-free absolute HTTP proxy URLs are allowed.");
        return;
      }
      if (decision.addresses.length === 0 || decision.addresses.some((address) => !isGlobalNetworkAddress(address))) {
        responseText(response, 403, "A globally routable DNS pin is required.");
        return;
      }
      const address = decision.addresses[0];
      const family = isIP(address);
      if (family !== 4 && family !== 6) {
        responseText(response, 403, "A valid DNS pin is required.");
        return;
      }
      const port = parsed.port ? Number(parsed.port) : 80;
      const target = Object.freeze({ hostname: decision.hostname, address, family, port }) satisfies ResolvedTarget;
      const upstreamSocket = await this.openPinnedSocket(target);
      const pinnedAgent = new Agent({ keepAlive: false, maxSockets: 1 });
      pinnedAgent.createConnection = () => upstreamSocket;
      const upstream = httpRequest({
        protocol: "http:",
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers: safeForwardHeaders(request.headers, normalizedHostHeader(parsed)),
        agent: pinnedAgent,
      });
      let transferred = 0;
      const exceedLimit = () => {
        upstream.destroy(new BrowserEgressProxyError("BROWSER_PROXY_BYTE_LIMIT", "Browser proxy byte limit exceeded."));
        upstreamSocket.destroy();
        response.destroy();
        request.destroy();
      };
      request.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        if (transferred > this.maxBytesPerExchange) exceedLimit();
      });
      upstream.once("response", (upstreamResponse) => {
        const responseLengthValue = upstreamResponse.headers["content-length"];
        const responseLength = typeof responseLengthValue === "string" && /^\d+$/u.test(responseLengthValue)
          ? Number(responseLengthValue)
          : null;
        if (responseLength !== null && (!Number.isSafeInteger(responseLength) || transferred + responseLength > this.maxBytesPerExchange)) {
          upstreamResponse.destroy();
          responseText(response, 502, "Upstream response exceeds the browser proxy limit.");
          return;
        }
        const headers = safeForwardHeaders(upstreamResponse.headers, normalizedHostHeader(parsed));
        delete headers.host;
        response.writeHead(upstreamResponse.statusCode ?? 502, headers);
        upstreamResponse.on("data", (chunk: Buffer) => {
          transferred += chunk.length;
          if (transferred > this.maxBytesPerExchange) exceedLimit();
        });
        upstreamResponse.pipe(response);
      });
      upstream.once("timeout", () => upstream.destroy(new BrowserEgressProxyError(
        "BROWSER_PROXY_UPSTREAM_TIMEOUT",
        "Browser proxy upstream timed out.",
      )));
      upstream.once("error", () => responseText(response, 502, "Browser proxy upstream failed."));
      upstream.once("close", () => pinnedAgent.destroy());
      response.once("close", () => {
        if (!response.writableFinished) upstream.destroy();
      });
      request.pipe(upstream);
    } catch (error) {
      responseText(response, proxyStatus(error), "Browser proxy destination was rejected.");
    }
  }

  private async handleConnect(request: IncomingMessage, client: Duplex, head: Buffer) {
    try {
      if (containsProxyCredentials(request.headers) || hasAmbiguousBodyFraming(request) ||
        request.headers["content-length"] !== undefined || request.headers["transfer-encoding"] !== undefined) {
        socketResponse(client, 403, "Forbidden");
        return;
      }
      const authority = request.url ?? "";
      if (!authority || Buffer.byteLength(authority, "utf8") > MAX_AUTHORITY_BYTES ||
        /[\s\u0000-\u001f\u007f\/@?#]/u.test(authority)) {
        socketResponse(client, 400, "Bad Request");
        return;
      }
      const ipv6 = authority.match(/^\[([0-9a-f:.]+)\]:(\d{1,5})$/iu);
      const hostnamePort = authority.match(/^([^:]+):(\d{1,5})$/u);
      const match = ipv6 ?? hostnamePort;
      if (!match) {
        socketResponse(client, 400, "Bad Request");
        return;
      }
      const hostname = match[1];
      const port = Number(match[2]);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        socketResponse(client, 400, "Bad Request");
        return;
      }
      const bracketed = hostname.includes(":") ? `[${hostname}]` : hostname;
      const target = await this.resolveTarget(`https://${bracketed}:${port}/`, "https:");
      const upstream = await this.openPinnedSocket(target);
      let transferred = head.length;
      let closedForLimit = false;
      const exceedLimit = () => {
        if (closedForLimit) return;
        closedForLimit = true;
        client.destroy(new BrowserEgressProxyError("BROWSER_PROXY_BYTE_LIMIT", "Browser proxy byte limit exceeded."));
        upstream.destroy();
      };
      client.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        if (transferred > this.maxBytesPerExchange) exceedLimit();
      });
      upstream.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        if (transferred > this.maxBytesPerExchange) exceedLimit();
      });
      client.once("error", () => upstream.destroy());
      upstream.once("error", () => client.destroy());
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => client.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: AiBrain\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    } catch (error) {
      socketResponse(client, proxyStatus(error), connectReason(proxyStatus(error)));
    }
  }
}
