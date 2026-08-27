import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserEgressProxy,
  BrowserEgressProxyError,
  browserDnsLookupFromEnvironment,
  type BrowserPinnedConnection,
} from "@/runtime/browser/egress-proxy";
import { BrowserNetworkPolicy, type BrowserDnsLookup } from "@/runtime/browser/network-policy";

const proxies = new Set<BrowserEgressProxy>();
const servers = new Set<NetServer | ReturnType<typeof createHttpServer>>();
const CLIENT_PASSWORD = "browser-client-password-00000000000000000001";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([...proxies].map((proxy) => proxy.stop()));
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  proxies.clear();
  servers.clear();
});

async function listen<T extends NetServer | ReturnType<typeof createHttpServer>>(server: T) {
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

function localConnector(onTarget?: (target: BrowserPinnedConnection) => void) {
  return async (target: BrowserPinnedConnection) => {
    onTarget?.(target);
    return await new Promise<Socket>((resolve, reject) => {
      const socket = netConnect({ host: "127.0.0.1", port: target.port });
      const abort = () => socket.destroy(new Error("aborted"));
      target.signal.addEventListener("abort", abort, { once: true });
      socket.once("connect", () => {
        target.signal.removeEventListener("abort", abort);
        resolve(socket);
      });
      socket.once("error", reject);
    });
  };
}

function publicPolicy(lookup?: BrowserDnsLookup) {
  return new BrowserNetworkPolicy({
    lookup: lookup ?? (async () => [{ address: "93.184.216.34", family: 4 }]),
  });
}

async function startProxy(options: ConstructorParameters<typeof BrowserEgressProxy>[0] = {}) {
  const proxy = new BrowserEgressProxy({ clientPassword: CLIENT_PASSWORD, ...options });
  proxies.add(proxy);
  const url = new URL(await proxy.start());
  const credentials = proxy.clientCredentials();
  url.username = credentials.username;
  url.password = credentials.password;
  return { proxy, url };
}

function clientAuthorization(proxy: URL) {
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`, "utf8").toString("base64")}`;
}

function proxyRequest(
  proxy: URL,
  target: string,
  options: Readonly<{ method?: string; headers?: Record<string, string>; body?: string }> = {},
) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: options.method ?? "GET",
      path: target,
      headers: { "proxy-authorization": clientAuthorization(proxy), ...options.headers },
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    request.end(options.body);
  });
}

function openConnect(proxy: URL, authority: string, headers: readonly string[] = []) {
  return new Promise<{ socket: Socket; head: Buffer }>((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: Number(proxy.port) });
    let pending = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const boundary = pending.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      socket.off("data", onData);
      const status = pending.subarray(0, boundary).toString("ascii");
      if (!status.startsWith("HTTP/1.1 200")) {
        reject(new Error(status));
        socket.destroy();
        return;
      }
      resolve({ socket, head: pending.subarray(boundary + 4) });
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write([
        `CONNECT ${authority} HTTP/1.1`,
        `Host: ${authority}`,
        `Proxy-Authorization: ${clientAuthorization(proxy)}`,
        ...headers,
        "",
        "",
      ].join("\r\n"));
    });
  });
}

function rawProxyResponse(proxy: URL, requestText: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: Number(proxy.port) });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.once("error", reject);
    socket.once("connect", () => {
      const authenticated = /^Proxy-Authorization:/imu.test(requestText)
        ? requestText
        : requestText.replace("\r\n", `\r\nProxy-Authorization: ${clientAuthorization(proxy)}\r\n`);
      socket.end(authenticated);
    });
  });
}

describe("BrowserEgressProxy lifecycle", () => {
  it("uses the authenticated isolated gateway as the production DNS resolver", async () => {
    let authorization = "";
    let requestedPath = "";
    const server = createHttpServer((request, response) => {
      authorization = String(request.headers["proxy-authorization"] ?? "");
      requestedPath = request.url ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        schemaVersion: 1,
        hostname: "public.example",
        addresses: [{ address: "93.184.216.34", family: 4 }],
      }));
    });
    const port = await listen(server);
    vi.stubEnv("AIBRAIN_EGRESS_PROXY_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("AIBRAIN_EGRESS_BROWSER_TOKEN", "browser-token-0000000000000000000000000000");

    const lookup = browserDnsLookupFromEnvironment();
    await expect(lookup?.("public.example", { all: true, verbatim: true }))
      .resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(requestedPath).toBe("/__aibrain_egress_resolve?hostname=public.example");
    expect(authorization).toBe("Bearer browser-token-0000000000000000000000000000");
  });

  it("binds only an ephemeral IPv4 loopback port and starts/stops idempotently", async () => {
    const proxy = new BrowserEgressProxy({ networkPolicy: publicPolicy(), connect: localConnector() });
    proxies.add(proxy);
    const [first, second] = await Promise.all([proxy.start(), proxy.start()]);
    expect(first).toBe(second);
    const url = new URL(first);
    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    await expect(proxy.health()).resolves.toMatchObject({ healthy: true, detail: "private-loopback-proxy-ready" });
    await Promise.all([proxy.stop(), proxy.stop()]);
    await expect(proxy.health()).resolves.toMatchObject({ healthy: false, detail: "private-loopback-proxy-stopped" });
  });

  it("rejects unsafe option values and production connector overrides", () => {
    expect(() => new BrowserEgressProxy({ maxConnections: 0 })).toThrowError(
      expect.objectContaining({ code: "BROWSER_PROXY_OPTIONS_INVALID" }),
    );
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new BrowserEgressProxy({ connect: localConnector() })).toThrowError(
      expect.objectContaining({ code: "BROWSER_PROXY_PRODUCTION_CONNECTOR_FORBIDDEN" }),
    );
    expect(() => new BrowserEgressProxy({ connect: localConnector() })).toThrow(BrowserEgressProxyError);
    expect(() => new BrowserEgressProxy()).toThrowError(
      expect.objectContaining({ code: "BROWSER_PROXY_UPSTREAM_REQUIRED" }),
    );
  });
});

describe("BrowserEgressProxy pinned transport", () => {
  it("forwards HTTP over exactly one policy resolution and the approved pinned address", async () => {
    let observedHost = "";
    let observedProxyHeader = "unset";
    let observedBody = "";
    const upstreamPort = await listen(createHttpServer((request, response) => {
      observedHost = request.headers.host ?? "";
      observedProxyHeader = String(request.headers["proxy-connection"]);
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.once("end", () => {
        observedBody = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "text/plain", "x-upstream": "yes" });
        response.end(`${request.method} ${request.url}`);
      });
    }));
    let lookups = 0;
    const lookup: BrowserDnsLookup = async () => {
      lookups += 1;
      return lookups === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    };
    const pins: BrowserPinnedConnection[] = [];
    const { url } = await startProxy({
      networkPolicy: publicPolicy(lookup),
      connect: localConnector((target) => pins.push(target)),
      allowedPorts: [upstreamPort],
    });

    const response = await proxyRequest(url, `http://public.example:${upstreamPort}/path?q=1`, {
      method: "POST",
      headers: {
        host: "attacker.invalid",
        "proxy-connection": "keep-alive",
        "content-type": "text/plain",
      },
      body: "pinned-body",
    });

    expect(response).toMatchObject({ status: 200, body: "POST /path?q=1" });
    expect(response.headers["x-upstream"]).toBe("yes");
    expect(observedHost).toBe(`public.example:${upstreamPort}`);
    expect(observedProxyHeader).toBe("undefined");
    expect(observedBody).toBe("pinned-body");
    expect(lookups).toBe(1);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      address: "93.184.216.34",
      family: 4,
      hostname: "public.example",
      port: upstreamPort,
    });
  });

  it("creates a transparent CONNECT tunnel without resolving again", async () => {
    const upstreamPort = await listen(createNetServer((socket) => socket.pipe(socket)));
    let lookups = 0;
    const pins: BrowserPinnedConnection[] = [];
    const { url } = await startProxy({
      networkPolicy: publicPolicy(async () => {
        lookups += 1;
        return [{ address: "2606:4700:4700::1111", family: 6 }];
      }),
      connect: localConnector((target) => pins.push(target)),
      allowedPorts: [upstreamPort],
    });
    const tunnel = await openConnect(url, `secure.example:${upstreamPort}`);
    const echoed = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = tunnel.head.length > 0 ? [tunnel.head] : [];
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const value = Buffer.concat(chunks).toString("utf8");
        if (value.length >= 16) {
          tunnel.socket.off("data", onData);
          resolve(value);
        }
      };
      tunnel.socket.on("data", onData);
      tunnel.socket.once("error", reject);
      tunnel.socket.write("tls-client-bytes");
    });
    expect(echoed).toBe("tls-client-bytes");
    expect(lookups).toBe(1);
    expect(pins[0]).toMatchObject({
      hostname: "secure.example",
      address: "2606:4700:4700::1111",
      family: 6,
      port: upstreamPort,
    });
    tunnel.socket.destroy();
  });

  it("carries the approved DNS pin through the authenticated isolated gateway", async () => {
    let handshake = "";
    const gatewayPort = await listen(createNetServer((socket) => {
      let pending = Buffer.alloc(0);
      const receiveHandshake = (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        const boundary = pending.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        socket.off("data", receiveHandshake);
        handshake = pending.subarray(0, boundary).toString("ascii");
        socket.write("HTTP/1.1 200 Connection Established\r\nConnection: keep-alive\r\n\r\n");
        const head = pending.subarray(boundary + 4);
        if (head.length > 0) socket.write(head);
        socket.on("data", (payload) => socket.write(payload));
      };
      socket.on("data", receiveHandshake);
    }));
    const { url } = await startProxy({
      networkPolicy: publicPolicy(async () => [{ address: "93.184.216.34", family: 4 }]),
      upstreamProxy: {
        url: `http://127.0.0.1:${gatewayPort}`,
        token: "browser_token_00000000000000000000000000000000",
      },
    });
    const tunnel = await openConnect(url, "secure.example:443");
    const echoed = new Promise<string>((resolve, reject) => {
      tunnel.socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
      tunnel.socket.once("error", reject);
    });
    tunnel.socket.write("tls-through-gateway");
    await expect(echoed).resolves.toBe("tls-through-gateway");
    expect(handshake).toContain("CONNECT secure.example:443 HTTP/1.1");
    expect(handshake).toContain("Proxy-Authorization: Bearer browser_token_00000000000000000000000000000000");
    expect(handshake).toContain("X-AiBrain-Pinned-IP: 93.184.216.34");
    tunnel.socket.destroy();
  });

  it("closes active CONNECT tunnels on idempotent stop", async () => {
    const upstreamPort = await listen(createNetServer(() => undefined));
    const { proxy, url } = await startProxy({
      networkPolicy: publicPolicy(),
      connect: localConnector(),
      allowedPorts: [upstreamPort],
    });
    const tunnel = await openConnect(url, `public.example:${upstreamPort}`);
    const closed = new Promise<void>((resolve) => tunnel.socket.once("close", () => resolve()));
    await proxy.stop();
    await closed;
    await expect(proxy.health()).resolves.toMatchObject({ healthy: false });
  });

  it("bounds bytes in both directions of a CONNECT tunnel", async () => {
    const upstreamPort = await listen(createNetServer((socket) => socket.pipe(socket)));
    const { url } = await startProxy({
      networkPolicy: publicPolicy(),
      connect: localConnector(),
      maxBytesPerExchange: 1_024,
      allowedPorts: [upstreamPort],
    });
    const tunnel = await openConnect(url, `public.example:${upstreamPort}`);
    const closed = new Promise<void>((resolve) => tunnel.socket.once("close", () => resolve()));
    tunnel.socket.write(Buffer.alloc(1_025, 1));
    await closed;
  });
});

describe("BrowserEgressProxy rejection and bounds", () => {
  it("rejects wrong proxy auth and URL credentials before DNS or connection", async () => {
    let lookups = 0;
    let connects = 0;
    const { url } = await startProxy({
      networkPolicy: publicPolicy(async () => {
        lookups += 1;
        return [{ address: "93.184.216.34", family: 4 }];
      }),
      connect: async () => {
        connects += 1;
        throw new Error("must not connect");
      },
    });
    await expect(proxyRequest(url, "http://public.example/", {
      headers: { "proxy-authorization": "Basic Zm9vOmJhcg==" },
    })).resolves.toMatchObject({ status: 407 });
    await expect(proxyRequest(url, "http://user:password@public.example/"))
      .resolves.toMatchObject({ status: 403 });
    const connectResponse = await rawProxyResponse(url, [
      "CONNECT user:password@public.example:443 HTTP/1.1",
      "Host: public.example:443",
      "",
      "",
    ].join("\r\n"));
    expect(connectResponse).toContain("400 Bad Request");
    const authenticatedConnect = await rawProxyResponse(url, [
      "CONNECT public.example:443 HTTP/1.1",
      "Host: public.example:443",
      "Proxy-Authorization: Basic Zm9vOmJhcg==",
      "",
      "",
    ].join("\r\n"));
    expect(authenticatedConnect).toContain("407 Proxy Authentication Required");
    expect(lookups).toBe(0);
    expect(connects).toBe(0);
  });

  it("allows only standard web ports unless an explicit private test policy overrides them", async () => {
    let connections = 0;
    const { url } = await startProxy({
      networkPolicy: publicPolicy(),
      connect: async () => {
        connections += 1;
        throw new Error("must not connect");
      },
    });
    await expect(proxyRequest(url, "http://public.example:8080/"))
      .resolves.toMatchObject({ status: 403 });
    await expect(rawProxyResponse(url, [
      "CONNECT public.example:8443 HTTP/1.1",
      "Host: public.example:8443",
      "",
      "",
    ].join("\r\n"))).resolves.toContain("403 Forbidden");
    expect(connections).toBe(0);
  });

  it("rejects private and mixed DNS results without opening an upstream socket", async () => {
    let connects = 0;
    const { url } = await startProxy({
      networkPolicy: publicPolicy(async (hostname) => hostname === "private.example"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]),
      connect: async () => {
        connects += 1;
        throw new Error("must not connect");
      },
    });
    await expect(proxyRequest(url, "http://private.example/"))
      .resolves.toMatchObject({ status: 403 });
    await expect(proxyRequest(url, "http://mixed.example/"))
      .resolves.toMatchObject({ status: 403 });
    expect(connects).toBe(0);
  });

  it("enforces response byte limits before streaming a declared oversized body", async () => {
    const body = "x".repeat(2_048);
    const upstreamPort = await listen(createHttpServer((_request, response) => {
      response.writeHead(200, { "content-length": Buffer.byteLength(body) });
      response.end(body);
    }));
    const { url } = await startProxy({
      networkPolicy: publicPolicy(),
      connect: localConnector(),
      maxBytesPerExchange: 1_024,
      allowedPorts: [upstreamPort],
    });
    await expect(proxyRequest(url, `http://public.example:${upstreamPort}/large`))
      .resolves.toMatchObject({ status: 502, body: "Upstream response exceeds the browser proxy limit." });
  });

  it("bounds stalled pinned connections with a gateway timeout", async () => {
    const { url } = await startProxy({
      networkPolicy: publicPolicy(),
      connectTimeoutMs: 100,
      connect: async () => await new Promise<Socket>(() => undefined),
    });
    await expect(proxyRequest(url, "http://public.example/"))
      .resolves.toMatchObject({ status: 504 });
  });

  it("rejects oversized request headers at the HTTP parser boundary", async () => {
    const { url } = await startProxy({
      networkPolicy: publicPolicy(),
      connect: localConnector(),
      maxHeaderBytes: 4_096,
    });
    const response = await rawProxyResponse(url, [
      "GET http://public.example/ HTTP/1.1",
      "Host: public.example",
      `X-Oversized: ${"a".repeat(8_192)}`,
      "",
      "",
    ].join("\r\n"));
    expect(response).toContain("431 Request Header Fields Too Large");
  });
});
