import { createServer as createHttpServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect as netConnect, createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EgressGateway,
  EgressGatewayError,
  isHealthProbeAuthorized,
  type EgressGatewayConfig,
  type GatewayConnection,
} from "../../infra/hetzner/egress/gateway.mjs";

const BROWSER_TOKEN = "browser-token-0000000000000000000000000000";
const WORKER_TOKEN = "worker-token-00000000000000000000000000000";
const SERVER_TOKEN = "server-token-00000000000000000000000000000";
const HEALTH_TOKEN = "health-token-00000000000000000000000000000";

function config(overrides: Partial<EgressGatewayConfig> = {}): EgressGatewayConfig {
  return {
    listenHost: "0.0.0.0",
    port: 0,
    browserToken: BROWSER_TOKEN,
    workerToken: WORKER_TOKEN,
    serverToken: SERVER_TOKEN,
    healthToken: HEALTH_TOKEN,
    workerHosts: new Set(["api.openai.com"]),
    supabaseHostname: "project-ref.supabase.co",
    maxHeaderBytes: 8_192,
    maxConnections: 16,
    maxAddresses: 4,
    connectTimeoutMs: 2_000,
    idleTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    maxBytesPerExchange: 1024 * 1024,
    ...overrides,
  };
}

function bearer(token: string) {
  return `Bearer ${token}`;
}

function basic(token: string, username = "aibrain") {
  return `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
}

function localUrl(url: string) {
  return url.replace("0.0.0.0", "127.0.0.1");
}

async function listen(server: NetServer | ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind TCP");
  return address.port;
}

async function close(server: NetServer | ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function localConnector(port: number, observed: GatewayConnection[]) {
  return async (target: GatewayConnection) => {
    observed.push(target);
    return await new Promise<Socket>((resolve, reject) => {
      const socket = netConnect({ host: "127.0.0.1", port });
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  };
}

async function proxyHttp(proxyUrl: string, target: string, headers: Record<string, string>) {
  const proxy = new URL(localUrl(proxyUrl));
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: proxy.port,
      method: "GET",
      path: target,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function connectExchange(proxyUrl: string, authority: string, authorization: string, pin?: string) {
  const proxy = new URL(localUrl(proxyUrl));
  return await new Promise<{ status: number; echoed: string }>((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: Number(proxy.port) });
    let response = Buffer.alloc(0);
    let established = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("CONNECT exchange timed out"));
    }, 3_000);
    socket.once("connect", () => {
      socket.write([
        `CONNECT ${authority} HTTP/1.1`,
        `Host: ${authority}`,
        `Proxy-Authorization: ${authorization}`,
        ...(pin ? [`X-AiBrain-Pinned-IP: ${pin}`] : []),
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, Buffer.from(chunk)]);
      if (!established) {
        const boundary = response.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        const status = Number(response.subarray(0, boundary).toString("ascii").split(" ")[1]);
        response = response.subarray(boundary + 4);
        if (status !== 200) {
          clearTimeout(timeout);
          socket.destroy();
          resolve({ status, echoed: "" });
          return;
        }
        established = true;
        socket.write("synthetic-payload");
      }
      if (established && response.toString("utf8").includes("synthetic-payload")) {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ status: 200, echoed: response.toString("utf8") });
      }
    });
    socket.once("error", reject);
  });
}

const gateways: EgressGateway[] = [];
const servers: Array<NetServer | ReturnType<typeof createHttpServer>> = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
  await Promise.all(servers.splice(0).map((server) => close(server)));
});

describe("physical egress gateway", () => {
  it("forwards browser HTTP only to its approved global pin and strips control credentials", async () => {
    let receivedHeaders: IncomingHttpHeaders = {};
    const upstream = createHttpServer((request, response) => {
      receivedHeaders = request.headers;
      response.end("synthetic-ok");
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);
    const observed: GatewayConnection[] = [];
    const lookup = vi.fn(async () => { throw new Error("browser channel must not resolve DNS twice"); });
    const gateway = new EgressGateway({ config: config(), lookup, connect: localConnector(upstreamPort, observed) });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    const result = await proxyHttp(proxyUrl, "http://browser.example/document?q=1", {
      "proxy-authorization": bearer(BROWSER_TOKEN),
      "x-aibrain-pinned-ip": "8.8.8.8",
    });

    expect(result).toEqual({ status: 200, body: "synthetic-ok" });
    expect(lookup).not.toHaveBeenCalled();
    expect(observed).toMatchObject([{ address: "8.8.8.8", family: 4, port: 80, hostname: "browser.example", channel: "browser" }]);
    expect(receivedHeaders["proxy-authorization"]).toBeUndefined();
    expect(receivedHeaders["x-aibrain-pinned-ip"]).toBeUndefined();
    expect(receivedHeaders.host).toBe("browser.example");
  });

  it("resolves browser DNS only through the authenticated isolated gateway", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ]);
    const gateway = new EgressGateway({ config: config(), lookup });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    const resolved = await proxyHttp(
      proxyUrl,
      "/__aibrain_egress_resolve?hostname=browser.example",
      { "proxy-authorization": bearer(BROWSER_TOKEN) },
    );

    expect(resolved.status).toBe(200);
    expect(JSON.parse(resolved.body)).toEqual({
      schemaVersion: 1,
      hostname: "browser.example",
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ],
    });
    expect(lookup).toHaveBeenCalledWith("browser.example", { all: true, verbatim: true });
    expect((await proxyHttp(
      proxyUrl,
      "/__aibrain_egress_resolve?hostname=browser.example",
      { "proxy-authorization": bearer(WORKER_TOKEN) },
    )).status).toBe(403);
    expect((await proxyHttp(proxyUrl, "/__aibrain_egress_resolve?hostname=localhost", {
      "proxy-authorization": bearer(BROWSER_TOKEN),
    })).status).toBe(403);
  });

  it("accepts standard Basic proxy auth only for worker/server and pins one worker DNS decision", async () => {
    const echo = createNetServer((socket) => socket.pipe(socket));
    servers.push(echo);
    const echoPort = await listen(echo);
    const observed: GatewayConnection[] = [];
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const gateway = new EgressGateway({ config: config(), lookup, connect: localConnector(echoPort, observed) });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    const result = await connectExchange(proxyUrl, "api.openai.com:443", basic(WORKER_TOKEN));

    expect(result.status).toBe(200);
    expect(result.echoed).toContain("synthetic-payload");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("api.openai.com", { all: true, verbatim: true });
    expect(observed).toMatchObject([{ address: "93.184.216.34", port: 443, hostname: "api.openai.com", channel: "worker" }]);

    expect((await connectExchange(proxyUrl, "browser.example:443", basic(BROWSER_TOKEN), "8.8.8.8")).status).toBe(407);
    expect((await connectExchange(proxyUrl, "api.openai.com:443", basic(WORKER_TOKEN, "worker"))).status).toBe(407);
  });

  it("rejects private, metadata and mixed DNS answers before opening a socket", async () => {
    const connector = vi.fn(async () => { throw new Error("must not connect"); });
    const gateway = new EgressGateway({
      config: config(),
      lookup: vi.fn(async () => [
        { address: "93.184.216.34", family: 4 as const },
        { address: "10.0.0.8", family: 4 as const },
      ]),
      connect: connector,
    });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    expect((await connectExchange(proxyUrl, "api.openai.com:443", basic(WORKER_TOKEN))).status).toBe(403);
    expect((await connectExchange(proxyUrl, "metadata.google.internal:443", bearer(BROWSER_TOKEN), "8.8.8.8")).status).toBe(403);
    expect((await connectExchange(proxyUrl, "browser.example:443", bearer(BROWSER_TOKEN), "169.254.169.254")).status).toBe(403);
    expect(connector).not.toHaveBeenCalled();
  });

  it("keeps channel allowlists separate and limits ports", async () => {
    const connector = vi.fn(async () => { throw new Error("must not connect"); });
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const gateway = new EgressGateway({ config: config(), lookup, connect: connector });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    expect((await connectExchange(proxyUrl, "project-ref.supabase.co:443", basic(WORKER_TOKEN))).status).toBe(403);
    expect((await connectExchange(proxyUrl, "api.openai.com:443", basic(SERVER_TOKEN))).status).toBe(403);
    expect((await connectExchange(proxyUrl, "project-ref.supabase.co:80", basic(SERVER_TOKEN))).status).toBe(403);
    expect((await connectExchange(proxyUrl, "browser.example:8443", bearer(BROWSER_TOKEN), "8.8.8.8")).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(connector).not.toHaveBeenCalled();
  });

  it("allows only the configured Supabase hostname on the server channel", async () => {
    const echo = createNetServer((socket) => socket.pipe(socket));
    servers.push(echo);
    const echoPort = await listen(echo);
    const observed: GatewayConnection[] = [];
    const lookup = vi.fn(async () => [{ address: "104.18.38.10", family: 4 as const }]);
    const gateway = new EgressGateway({ config: config(), lookup, connect: localConnector(echoPort, observed) });
    gateways.push(gateway);
    const proxyUrl = await gateway.start();

    expect((await connectExchange(proxyUrl, "project-ref.supabase.co:443", basic(SERVER_TOKEN))).status).toBe(200);
    expect(observed).toMatchObject([{ hostname: "project-ref.supabase.co", address: "104.18.38.10", port: 443, channel: "server" }]);
  });

  it("has idempotent lifecycle, loopback health and fail-closed secret validation", async () => {
    expect(() => new EgressGateway({ config: config({ serverToken: WORKER_TOKEN }) })).toThrowError(EgressGatewayError);
    expect(() => new EgressGateway({ config: config({ healthToken: SERVER_TOKEN }) })).toThrowError(EgressGatewayError);
    expect(() => new EgressGateway({ config: config({ workerHosts: new Set(["localhost"]) }) })).toThrowError(EgressGatewayError);

    const gateway = new EgressGateway({ config: config() });
    gateways.push(gateway);
    const [first, concurrent] = await Promise.all([gateway.start(), gateway.start()]);
    expect(concurrent).toBe(first);
    expect(await gateway.start()).toBe(first);
    expect(gateway.health().healthy).toBe(true);
    expect((await proxyHttp(first, "http://unused.invalid", {})).status).toBe(407);

    const health = await proxyHttp(first, "/__aibrain_egress_health", {});
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ healthy: true });
    await gateway.stop();
    await gateway.stop();
    expect(gateway.health().healthy).toBe(false);
  });

  it("requires the dedicated secret for a non-loopback health probe", () => {
    expect(isHealthProbeAuthorized("172.20.0.4", undefined, HEALTH_TOKEN)).toBe(false);
    expect(isHealthProbeAuthorized("172.20.0.4", bearer(WORKER_TOKEN), HEALTH_TOKEN)).toBe(false);
    expect(isHealthProbeAuthorized("172.20.0.4", bearer(HEALTH_TOKEN), HEALTH_TOKEN)).toBe(true);
    expect(isHealthProbeAuthorized("127.0.0.1", undefined, HEALTH_TOKEN)).toBe(true);
  });
});
