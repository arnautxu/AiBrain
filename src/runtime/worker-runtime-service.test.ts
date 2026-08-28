import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  JsonValue,
  TransportHealth,
} from "@/runtime/transport";
import { MaintenanceCoordinator } from "@/operations/maintenance";
import { WorkerAppServerClient } from "@/runtime/worker-runtime-service";
import type { WorkerRuntimeHandle, WorkerRoots } from "@/runtime/workers/types";

class AsyncEvents implements AsyncIterable<AppServerEvent> {
  private values: AppServerEvent[] = [];
  private waiters: Array<(value: IteratorResult<AppServerEvent>) => void> = [];

  push(value: AppServerEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  [Symbol.asyncIterator](): AsyncIterator<AppServerEvent> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { done: false, value };
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeTransport implements AppServerTransport {
  readonly sent: AppServerRequest[] = [];
  readonly stream = new AsyncEvents();
  sequence = 0;

  async connect() {}

  async send(message: AppServerRequest) {
    this.sent.push(message);
    if (message.kind !== "rpc-request") return;
    const result = (() => {
      switch (message.rpc.method) {
        case "initialize": return { userAgent: "codex-test" };
        case "account/read": return { account: { type: "chatgpt", planType: "team" } };
        case "model/list": return {
          data: [{
            model: "gpt-test",
            displayName: "GPT Test",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportedReasoningEfforts: [],
          }],
        };
        case "skills/list": return { data: [] };
        case "modelProvider/capabilities/read": return { webSearch: true, imageGeneration: false };
        case "account/rateLimits/read": return { rateLimits: { primary: { usedPercent: 12 } } };
        case "account/usage/read": return { summary: { lifetimeTokens: 42 } };
        default: return {};
      }
    })() as JsonValue;
    this.sequence += 1;
    this.stream.push({
      eventId: `event-${this.sequence}`,
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
      message: { kind: "rpc-response", rpc: { id: message.rpc.id, result } },
    });
  }

  events() { return this.stream; }
  async acknowledge() {}
  async health(): Promise<TransportHealth> {
    return {
      healthy: true,
      state: "connected",
      endpoint: "ws://127.0.0.1:1/app-server",
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
  async close() {}
}

function handle(transport: AppServerTransport): WorkerRuntimeHandle {
  const roots = Object.fromEntries([
    "userRoot", "runtimeRoot", "codexHome", "home", "xdgRoot", "xdgCache",
    "xdgConfig", "xdgData", "xdgState", "workspace", "staging", "stagingTemp",
    "artifacts", "browserRoot", "browserProfile", "browserDownloads", "auditRoot",
    "transportAudit", "manifest",
  ].map((key) => [key, `/private/${key}`])) as WorkerRoots;
  return Object.freeze({
    installationId: "qa-company",
    userId: "00000000-0000-4000-8000-000000000001",
    workerId: "worker-00000000-0000-4000-8000-000000000001",
    roots,
    transport,
  });
}

describe("worker App Server client", () => {
  it("initializes exactly once and reads the catalog over the scoped transport", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));
    await Promise.all([client.initialize(), client.initialize(), client.initialize()]);
    const connection = await client.connection("/private/workspace/projects/example");

    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && item.rpc.method === "initialize")).toHaveLength(1);
    expect(transport.sent.find((item) =>
      item.kind === "rpc-request" && item.rpc.method === "initialize")).toMatchObject({
      rpc: {
        params: {
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        },
      },
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-notification" && item.rpc.method === "initialized")).toHaveLength(1);
    expect(connection).toMatchObject({
      connected: true,
      planType: "team",
      processWarm: true,
      webSearch: true,
      imageGeneration: false,
      models: [{ id: "gpt-test", isDefault: true }],
    });
    await client.close();
  });

  it("reports the verified account without waiting for the optional catalog", async () => {
    const transport = new FakeTransport();
    const client = new WorkerAppServerClient(handle(transport));

    await expect(client.connectionSummary()).resolves.toMatchObject({
      connected: true,
      planType: "team",
      processWarm: true,
      models: [],
      skills: [],
    });
    expect(transport.sent.filter((item) =>
      item.kind === "rpc-request" && [
        "model/list",
        "skills/list",
        "modelProvider/capabilities/read",
        "account/rateLimits/read",
        "account/usage/read",
      ].includes(item.rpc.method),
    )).toHaveLength(0);
    await client.close();
  });

  it("requires an admitted maintenance lease before sending turn/start to the gateway", async () => {
    const transport = new FakeTransport();
    const maintenance = new MaintenanceCoordinator();
    const client = new WorkerAppServerClient(handle(transport), maintenance);

    await expect(client.request("turn/start", {}, "turn-without-lease"))
      .rejects.toMatchObject({ code: "MAINTENANCE_ACTIVE" });
    expect(transport.sent).toEqual([]);

    const lease = maintenance.acquire("turn");
    const draining = maintenance.enter({ timeoutMs: 1_000 });
    await expect(client.request("turn/start", {}, "turn-with-lease", 1_000, undefined, lease))
      .resolves.toEqual({});
    expect(transport.sent.some((message) =>
      message.kind === "rpc-request" && message.rpc.method === "turn/start")).toBe(true);

    lease.release();
    await expect(draining).resolves.toMatchObject({ phase: "maintenance", activeActivities: 0 });
    await client.close();
  });
});
