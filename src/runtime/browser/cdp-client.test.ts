import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  CdpClientError,
  normalizePrivateDevToolsWebSocket,
  PrivateCdpClient,
  type PrivateCdpMethod,
} from "@/runtime/browser/cdp-client";

const servers: WebSocketServer[] = [];

async function server(
  handler: (message: Record<string, unknown>, send: (value: unknown) => void) => void,
) {
  const instance = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(instance);
  await once(instance, "listening");
  instance.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      handler(message, (value) => socket.send(JSON.stringify(value)));
    });
  });
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("unexpected WebSocket address");
  return `ws://127.0.0.1:${address.port}/devtools/page/synthetic-page`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((instance) => new Promise<void>((resolve) => {
    for (const client of instance.clients) client.terminate();
    instance.close(() => resolve());
  })));
});

describe("PrivateCdpClient", () => {
  it("sends allowlisted commands and delivers bounded private events", async () => {
    const endpoint = await server((message, send) => {
      send({ id: message.id, result: { product: "Chrome/140.0.0.0" } });
      send({ method: "Page.loadEventFired", params: { timestamp: 123 } });
    });
    const client = await PrivateCdpClient.connect(endpoint);
    const event = client.waitForEvent<{ timestamp: number }>("Page.loadEventFired");
    await expect(client.send<{ product: string }>("Browser.getVersion"))
      .resolves.toEqual({ product: "Chrome/140.0.0.0" });
    await expect(client.send("Fetch.enable", {
      patterns: [{ urlPattern: "https://*", requestStage: "Request" }],
    })).resolves.toEqual({ product: "Chrome/140.0.0.0" });
    await expect(event).resolves.toEqual({ timestamp: 123 });
    await client.close();
  });

  it("rejects non-loopback endpoints, non-allowlisted methods and saturated commands", async () => {
    await expect(PrivateCdpClient.connect("ws://192.0.2.1:9222/devtools/page/x"))
      .rejects.toMatchObject({ code: "CDP_ENDPOINT_NOT_PRIVATE" });
    const endpoint = await server(() => undefined);
    const client = await PrivateCdpClient.connect(endpoint, {
      commandTimeoutMs: 50,
      maxPendingCommands: 1,
    });
    const pending = client.send("Browser.getVersion");
    await expect(client.send("Page.enable")).rejects.toMatchObject({ code: "CDP_BACKPRESSURE" });
    await expect(client.send("Runtime.evaluate" as PrivateCdpMethod))
      .rejects.toMatchObject({ code: "CDP_METHOD_REJECTED" });
    await expect(pending).rejects.toMatchObject({ code: "CDP_COMMAND_TIMEOUT" });
    await client.close();
  });

  it("normalizes Chrome-reported localhost endpoints to a literal loopback binding", () => {
    expect(normalizePrivateDevToolsWebSocket(
      "ws://localhost:49152/devtools/browser/abc-123",
      49_152,
    )).toBe("ws://127.0.0.1:49152/devtools/browser/abc-123");
    expect(() => normalizePrivateDevToolsWebSocket(
      "ws://example.com:49152/devtools/browser/abc-123",
      49_152,
    )).toThrow(CdpClientError);
  });
});
