import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppServerRpcRouter,
  FileTransportEventJournal,
  WebSocketAppServerTransport,
} from "@/runtime/transport";
import {
  NodeWebSocketFactory,
  LocalGatewayWorkerRuntimeFactory,
  PrivateWorkerGateway,
  workerEgressEnvironment,
  workerTransportAuditRoot,
} from "@/runtime/workers/local-gateway-runtime";
import type { WorkerLaunchContext } from "@/runtime/workers/types";
import { ResourceLockManager } from "@/storage";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_SCOPE_DIGEST = createHash("sha256")
  .update(JSON.stringify(["thread-1", "turn-1"]))
  .digest("hex");
const roots: string[] = [];

describe("worker egress environment", () => {
  it("exposes only the restricted worker channel through standard proxy variables", () => {
    const token = "worker_token_000000000000000000000000000000000";
    const environment = workerEgressEnvironment({
      NODE_ENV: "production",
      AIBRAIN_EGRESS_PROXY_URL: "http://egress-gateway:8080",
      AIBRAIN_EGRESS_WORKER_TOKEN: token,
      AIBRAIN_EGRESS_BROWSER_TOKEN: "browser-secret-must-not-leak",
      AIBRAIN_EGRESS_SERVER_TOKEN: "server-secret-must-not-leak",
    });
    expect(environment).toMatchObject({
      NO_PROXY: "127.0.0.1,localhost,::1",
      HTTP_PROXY: expect.any(String),
      HTTPS_PROXY: expect.any(String),
      ALL_PROXY: expect.any(String),
    });
    const proxy = new URL(environment.HTTPS_PROXY);
    expect(proxy).toMatchObject({
      protocol: "http:",
      hostname: "egress-gateway",
      port: "8080",
      username: "aibrain",
      password: token,
    });
    expect(JSON.stringify(environment)).not.toContain("browser-secret");
    expect(JSON.stringify(environment)).not.toContain("server-secret");
  });

  it("fails closed in production and rejects partial or credential-bearing configuration", () => {
    expect(() => workerEgressEnvironment({ NODE_ENV: "production" })).toThrow(/required/u);
    expect(() => workerEgressEnvironment({
      NODE_ENV: "test",
      AIBRAIN_EGRESS_PROXY_URL: "http://egress-gateway:8080",
    })).toThrow(/required/u);
    expect(() => workerEgressEnvironment({
      NODE_ENV: "test",
      AIBRAIN_EGRESS_PROXY_URL: "http://attacker:password@egress-gateway:8080",
      AIBRAIN_EGRESS_WORKER_TOKEN: "worker_token_000000000000000000000000000000000",
    })).toThrow(/credential-free/u);
  });
});

describe("worker transport audit isolation", () => {
  it("uses stable disjoint journals for the app and detached automation worker", () => {
    const root = "/var/lib/aibrain/data/users/user/audit/transport";
    expect(workerTransportAuditRoot(root, "app")).toBe(path.join(root, "runtime-instances", "app"));
    expect(workerTransportAuditRoot(root, "automation-worker")).toBe(
      path.join(root, "runtime-instances", "automation-worker"),
    );
    expect(workerTransportAuditRoot(root, "app")).not.toBe(workerTransportAuditRoot(root, "automation-worker"));
  });

  it("rejects traversal and unstable instance identifiers", () => {
    expect(() => workerTransportAuditRoot("/audit", "../worker")).toThrow(/invalid/u);
    expect(() => workerTransportAuditRoot("/audit", "worker/other")).toThrow(/invalid/u);
    expect(() => workerTransportAuditRoot("/audit", "Automation Worker")).toThrow(/invalid/u);
  });
});

function initializeRequest(clientRequestId = "initialize-request-1") {
  return {
    clientRequestId,
    kind: "rpc-request" as const,
    rpc: {
      method: "initialize" as const,
      id: clientRequestId,
      params: {
        clientInfo: { name: "aibrain_test", title: "AiBrain Test", version: "1.0.0" },
        capabilities: null,
      },
    },
  };
}

function approvalResponse(clientRequestId = `server-response:approval-event:${APPROVAL_SCOPE_DIGEST}`) {
  return {
    clientRequestId,
    kind: "rpc-response" as const,
    rpc: { id: "approval-1", result: { decision: "accept" } },
  };
}

async function nextEvent(transport: WebSocketAppServerTransport) {
  const iterator = transport.events()[Symbol.asyncIterator]();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for worker event.")), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe("private per-user worker gateway", () => {
  let root: string;
  let context: WorkerLaunchContext;
  let fakeServer: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aibrain-worker-gateway-"));
    roots.push(root);
    const userRoot = path.join(root, "users", USER_ID);
    const runtimeRoot = path.join(userRoot, "runtime");
    const transportAudit = path.join(userRoot, "audit", "transport");
    const workspace = path.join(userRoot, "workspace");
    await Promise.all([
      mkdir(transportAudit, { recursive: true, mode: 0o700 }),
      mkdir(workspace, { recursive: true, mode: 0o700 }),
    ]);
    context = {
      installationId: "qa-company",
      userId: USER_ID,
      workerId: `worker-${USER_ID}`,
      environment: {
        HOME: path.join(runtimeRoot, "home"),
        CODEX_HOME: path.join(runtimeRoot, "codex-home"),
        XDG_CACHE_HOME: path.join(runtimeRoot, "xdg", "cache"),
        XDG_CONFIG_HOME: path.join(runtimeRoot, "xdg", "config"),
        XDG_DATA_HOME: path.join(runtimeRoot, "xdg", "data"),
        XDG_STATE_HOME: path.join(runtimeRoot, "xdg", "state"),
        TMPDIR: path.join(userRoot, "staging", "tmp"),
      },
      mounts: {
        runtimeReadOnly: [path.join(root, "company"), path.join(root, "source-ro")],
        runtimeReadWrite: [runtimeRoot, workspace, transportAudit],
        browserReadWrite: [path.join(userRoot, "browser")],
      },
      workspace,
      staging: path.join(userRoot, "staging"),
      artifacts: path.join(userRoot, "artifacts"),
      transportAudit,
      browser: {
        profile: path.join(userRoot, "browser", "profile"),
        downloads: path.join(userRoot, "browser", "downloads"),
      },
    };
    fakeServer = path.join(root, "fake-app-server.mjs");
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'lines.on("line", (line) => {',
      '  const request = JSON.parse(line);',
      '  if (request.id !== undefined) process.stdout.write(JSON.stringify({ id: request.id, result: { acceptedMethod: request.method } }) + "\\n");',
      '});',
    ].join("\n"), { mode: 0o600 });
  });

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  function gateway(options: { maxRetainedCompletedRequests?: number } = {}) {
    return new PrivateWorkerGateway({
      context,
      ...options,
      processFactory: () => spawn(process.execPath, [fakeServer], {
        cwd: context.workspace,
        env: { NODE_ENV: "test", ...context.environment },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    });
  }

  function transport(worker: PrivateWorkerGateway) {
    if (!worker.endpoint) throw new Error("Gateway did not start.");
    const journal = new FileTransportEventJournal({
      filePath: path.join(context.transportAudit, "test-client-events.jsonl"),
      lockManager: new ResourceLockManager({
        rootDirectory: path.join(context.transportAudit, "test-client-locks"),
      }),
    });
    return new WebSocketAppServerTransport({
      endpoint: worker.endpoint,
      socketFactory: new NodeWebSocketFactory(),
      auth: {
        placement: "authorization-header",
        credentialProvider: {
          async getCredential() {
            return { kind: "capability-token" as const, token: worker.token };
          },
        },
      },
      journal,
      // Keep this integration fixture responsive without treating transient CI
      // scheduler stalls as a network failure. Heartbeat timeout behaviour is
      // covered by the dedicated transport tests.
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 2_000,
      reconnectBaseDelayMs: 5,
      reconnectMaxDelayMs: 20,
      reconnectJitterRatio: 0,
    });
  }

  it("runs app and automation transports concurrently without sharing replay journals", async () => {
    const processFactory = () => spawn(process.execPath, [fakeServer], {
      cwd: context.workspace,
      env: { NODE_ENV: "test", ...context.environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const appRuntime = new LocalGatewayWorkerRuntimeFactory({
      processFactory,
      runtimeInstanceId: "app",
    }).create(context);
    const automationRuntime = new LocalGatewayWorkerRuntimeFactory({
      processFactory,
      runtimeInstanceId: "automation-worker",
    }).create(context);
    try {
      await Promise.all([appRuntime.start(), automationRuntime.start()]);
      await Promise.all([appRuntime.transport.connect(), automationRuntime.transport.connect()]);
      await Promise.all([
        appRuntime.transport.send(initializeRequest("shared-request-id")),
        automationRuntime.transport.send(initializeRequest("shared-request-id")),
      ]);
      const [appEvent, automationEvent] = await Promise.all([
        appRuntime.transport.events()[Symbol.asyncIterator]().next(),
        automationRuntime.transport.events()[Symbol.asyncIterator]().next(),
      ]);
      expect(appEvent.value).toMatchObject({ message: { kind: "rpc-response", rpc: { id: "shared-request-id" } } });
      expect(automationEvent.value).toMatchObject({ message: { kind: "rpc-response", rpc: { id: "shared-request-id" } } });
      await Promise.all([
        readFile(path.join(workerTransportAuditRoot(context.transportAudit, "app"), "gateway-events.jsonl"), "utf8"),
        readFile(path.join(workerTransportAuditRoot(context.transportAudit, "automation-worker"), "gateway-events.jsonl"), "utf8"),
      ]);
    } finally {
      await Promise.allSettled([
        appRuntime.transport.close(),
        automationRuntime.transport.close(),
        appRuntime.stop(),
        automationRuntime.stop(),
      ]);
    }
  });

  it("authenticates on loopback, validates the pinned RPC contract and persists the event before delivery", async () => {
    const worker = gateway();
    await worker.start();
    const client = transport(worker);
    try {
      await client.connect();
      await client.send(initializeRequest());
      const received = await nextEvent(client);
      expect(received).toMatchObject({
        done: false,
        value: {
          sequence: 1,
          message: {
            kind: "rpc-response",
            rpc: { id: "initialize-request-1", result: { acceptedMethod: "initialize" } },
          },
        },
      });
      expect(await worker.health()).toMatchObject({ healthy: true, state: "running" });
    } finally {
      await client.close();
      await worker.stop();
    }
  });

  it("admits a new chat while an earlier App Server output is still being persisted", async () => {
    const worker = gateway();
    await worker.start();
    const client = transport(worker);
    let releaseOutput!: () => void;
    const outputGate = new Promise<void>((resolve) => { releaseOutput = resolve; });
    let outputPersistenceStarted!: () => void;
    const outputPersistence = new Promise<void>((resolve) => { outputPersistenceStarted = resolve; });
    const internals = worker as unknown as {
      events: { append(event: Parameters<FileTransportEventJournal["append"]>[0]): Promise<boolean> };
    };
    const append = internals.events.append.bind(internals.events);
    let firstOutput = true;
    internals.events.append = async (event) => {
      if (firstOutput) {
        firstOutput = false;
        outputPersistenceStarted();
        await outputGate;
      }
      return append(event);
    };
    try {
      await client.connect();
      await client.send(initializeRequest("busy-chat"));
      await outputPersistence;

      let newChatAdmitted = false;
      const newChat = client.send(initializeRequest("new-chat")).then(() => { newChatAdmitted = true; });
      await vi.waitFor(() => expect(newChatAdmitted).toBe(true), { timeout: 5_000 });

      releaseOutput();
      await newChat;
      const responses = await Promise.all([nextEvent(client), nextEvent(client)]);
      expect(responses.map(({ value }) => value && value.message.kind === "rpc-response"
        ? value.message.rpc.id
        : null)).toEqual(["busy-chat", "new-chat"]);
    } finally {
      releaseOutput();
      await client.close();
      await worker.stop();
    }
  });

  it("rejects unauthenticated WebSockets before protocol negotiation", async () => {
    const worker = gateway();
    await worker.start();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(worker.endpoint!, { headers: { Authorization: "Bearer invalid-token-value-that-is-long-enough" } });
        socket.once("unexpected-response", (_, response) => resolve(response.statusCode ?? 0));
        socket.once("error", reject);
      });
      expect(status).toBe(401);
    } finally {
      await worker.stop();
    }
  });

  it("recovers the durable cursor and replays a completed duplicate without executing it in the restarted child", async () => {
    const firstWorker = gateway();
    await firstWorker.start();
    const firstClient = transport(firstWorker);
    await firstClient.connect();
    await firstClient.send(initializeRequest());
    const firstEvent = await nextEvent(firstClient);
    expect(firstEvent.value).toMatchObject({ sequence: 1 });
    if (!firstEvent.done) await firstClient.acknowledge(firstEvent.value);
    await firstClient.close();
    await firstWorker.stop();

    const restartedWorker = gateway();
    await restartedWorker.start();
    const restartedClient = transport(restartedWorker);
    try {
      await restartedClient.connect();
      await restartedClient.send(initializeRequest());
      const repeated = await nextEvent(restartedClient);
      expect(repeated.value).toMatchObject({
        sequence: 2,
        message: { kind: "rpc-response", rpc: { id: "initialize-request-1" } },
      });
    } finally {
      await restartedClient.close();
      await restartedWorker.stop();
    }
  });

  it("acknowledges an identical in-flight retry without dispatching it twice", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const request = JSON.parse(line);',
      '  if (request.id !== undefined) setTimeout(() => write({ id: request.id, result: { acceptedMethod: request.method } }), 200);',
      '});',
    ].join("\n"), { mode: 0o600 });
    const worker = gateway();
    await worker.start();
    const firstClient = transport(worker);
    const retryingClient = transport(worker);
    try {
      await firstClient.connect();
      await firstClient.send(initializeRequest());
      await firstClient.close();

      await retryingClient.connect();
      await retryingClient.send(initializeRequest());
      const received = await nextEvent(retryingClient);
      expect(received.value).toMatchObject({
        sequence: 1,
        message: {
          kind: "rpc-response",
          rpc: { id: "initialize-request-1", result: { acceptedMethod: "initialize" } },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const durableEvents = (await readFile(
        path.join(context.transportAudit, "gateway-events.jsonl"),
        "utf8",
      )).trim().split("\n");
      expect(durableEvents).toHaveLength(1);
    } finally {
      await firstClient.close();
      await retryingClient.close();
      await worker.stop();
    }
  });

  it("rejects an accepted request left uncertain by an App Server restart", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'lines.on("line", () => {});',
    ].join("\n"), { mode: 0o600 });
    const firstWorker = gateway();
    await firstWorker.start();
    const firstClient = transport(firstWorker);
    await firstClient.connect();
    await firstClient.send(initializeRequest());
    await firstClient.close();
    await firstWorker.stop();

    const restartedWorker = gateway();
    await restartedWorker.start();
    const restartedClient = transport(restartedWorker);
    try {
      await restartedClient.connect();
      await expect(restartedClient.send(initializeRequest())).rejects.toThrow(/uncertain/u);
    } finally {
      await restartedClient.close();
      await restartedWorker.stop();
    }
  });

  it("bounds completed request history while retaining uncertain outcomes", async () => {
    const worker = gateway({ maxRetainedCompletedRequests: 2 });
    await worker.start();
    const client = transport(worker);
    try {
      await client.connect();
      for (let index = 1; index <= 4; index += 1) {
        await client.send(initializeRequest(`bounded-request-${index}`));
        const received = await nextEvent(client);
        if (!received.done) await client.acknowledge(received.value);
      }
      const lines = (await readFile(
        path.join(context.transportAudit, "gateway-requests.jsonl"),
        "utf8",
      )).trim().split("\n");
      expect(lines.length).toBeLessThanOrEqual(4);
    } finally {
      await client.close();
      await worker.stop();
    }
  });

  it("confirms a server response only after durable progress in the same turn", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) {',
      '    write({ id: rpc.id, result: {} });',
      '    write({ method: "item/commandExecution/requestApproval", id: "approval-1", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1, environmentId: null, command: "pwd" } });',
      '    return;',
      '  }',
      '  setTimeout(() => write({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "agent-1", delta: "approval processed" } }), 100);',
      '});',
    ].join("\n"), { mode: 0o600 });
    const worker = gateway();
    await worker.start();
    const client = transport(worker);
    try {
      await client.connect();
      await client.send(initializeRequest());
      const initialized = await nextEvent(client);
      const approval = await nextEvent(client);
      expect(approval.value).toMatchObject({
        message: { kind: "rpc-request", rpc: { id: "approval-1" } },
      });
      if (!initialized.done) await client.acknowledge(initialized.value);
      if (approval.done) throw new Error("Expected a durable approval event.");
      await client.acknowledge(approval.value);
      const responseId = `server-response:${approval.value.eventId}:${APPROVAL_SCOPE_DIGEST}`;

      let confirmed = false;
      const submission = client.send(approvalResponse(responseId)).then(() => { confirmed = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(confirmed).toBe(false);
      await submission;
      const progress = await nextEvent(client);
      expect(progress.value).toMatchObject({
        message: { kind: "rpc-notification", rpc: { params: { delta: "approval processed" } } },
      });
    } finally {
      await client.close();
      await worker.stop();
    }
  });

  it("ACKs an already completed server response when recovery cannot reproduce its original decision", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) {',
      '    write({ id: rpc.id, result: {} });',
      '    write({ method: "item/commandExecution/requestApproval", id: "approval-1", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1, environmentId: null, command: "pwd" } });',
      '    return;',
      '  }',
      '  write({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "agent-1", delta: "approval processed once" } });',
      '});',
    ].join("\n"), { mode: 0o600 });
    const worker = gateway();
    await worker.start();
    const firstClient = transport(worker);
    try {
      await firstClient.connect();
      await firstClient.send(initializeRequest());
      const initialized = await nextEvent(firstClient);
      const approval = await nextEvent(firstClient);
      if (!initialized.done) await firstClient.acknowledge(initialized.value);
      if (approval.done) throw new Error("Expected a durable approval event.");
      await firstClient.acknowledge(approval.value);
      const responseId = `server-response:${approval.value.eventId}:${APPROVAL_SCOPE_DIGEST}`;
      await firstClient.send(approvalResponse(responseId));
      const progress = await nextEvent(firstClient);
      if (!progress.done) await firstClient.acknowledge(progress.value);
      await firstClient.close();

      const recoveredClient = transport(worker);
      try {
        await recoveredClient.connect();
        await expect(recoveredClient.send({
          ...approvalResponse(responseId),
          rpc: { id: "approval-1", error: { code: -32602, message: "No active route." } },
        })).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const progressEvents = (await readFile(
          path.join(context.transportAudit, "gateway-events.jsonl"),
          "utf8",
        )).trim().split("\n").map((line) => JSON.parse(line) as {
          payload: { message: { kind: string; rpc: { method?: string } } };
        }).filter((entry) => entry.payload.message.kind === "rpc-notification"
          && entry.payload.message.rpc.method === "item/agentMessage/delta");
        expect(progressEvents).toHaveLength(1);
      } finally {
        await recoveredClient.close();
      }
    } finally {
      await firstClient.close();
      await worker.stop();
    }
  });

  it("drains an uncertain response from an earlier child before a new initialize response", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) {',
      '    write({ id: rpc.id, result: {} });',
      '    write({ method: "item/commandExecution/requestApproval", id: "approval-1", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1, environmentId: null, command: "pwd" } });',
      '    return;',
      '  }',
      '  process.exit(42);',
      '});',
    ].join("\n"), { mode: 0o600 });
    const firstWorker = gateway();
    await firstWorker.start();
    const firstClient = transport(firstWorker);
    await firstClient.connect();
    await firstClient.send(initializeRequest());
    const initialized = await nextEvent(firstClient);
    const approval = await nextEvent(firstClient);
    if (!initialized.done) await firstClient.acknowledge(initialized.value);
    expect(approval.value).toMatchObject({
      message: { kind: "rpc-request", rpc: { id: "approval-1" } },
    });
    if (approval.done) throw new Error("Expected a durable approval event.");
    const uncertain = firstClient.send(approvalResponse(
      `server-response:${approval.value.eventId}:${APPROVAL_SCOPE_DIGEST}`,
    )).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(async () => expect((await firstWorker.health()).state).toBe("failed"));
    await firstClient.close();
    expect(await uncertain).toBeInstanceOf(Error);
    await firstWorker.stop();

    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) write({ id: rpc.id, result: {} });',
      '  else write({ method: "warning", params: { message: "stale response was dispatched" } });',
      '});',
    ].join("\n"), { mode: 0o600 });
    const restartedWorker = gateway();
    await restartedWorker.start();
    const restartedClient = transport(restartedWorker);
    const router = new AppServerRpcRouter(restartedClient);
    try {
      await expect(router.request(
        initializeRequest("initialize-after-stale-replay").rpc,
        3_000,
      )).resolves.toEqual({});
      const durableEvents = (await readFile(
        path.join(context.transportAudit, "gateway-events.jsonl"),
        "utf8",
      )).trim().split("\n").map((line) => JSON.parse(line) as {
        payload: { message: { kind: string; rpc: { method?: string } } };
      });
      expect(durableEvents.filter((entry) =>
        entry.payload.message.kind === "rpc-notification"
        && entry.payload.message.rpc.method === "warning"
      )).toHaveLength(0);
      await vi.waitFor(async () => {
        const cursor = JSON.parse(await readFile(
          path.join(context.transportAudit, "test-client-events.jsonl.delivery.json"),
          "utf8",
        )) as { sequence: number };
        expect(cursor.sequence).toBeGreaterThanOrEqual(3);
      }, { timeout: 5_000 });
    } finally {
      await router.close();
      await restartedClient.close();
      await restartedWorker.stop();
    }
  }, 15_000);

  it("does not dispatch a first response to a server request from an earlier App Server", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  write({ id: rpc.id, result: {} });',
      '  write({ method: "item/commandExecution/requestApproval", id: "approval-1", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1, environmentId: null, command: "pwd" } });',
      '  setTimeout(() => process.exit(42), 25);',
      '});',
    ].join("\n"), { mode: 0o600 });
    const firstWorker = gateway();
    await firstWorker.start();
    const firstClient = transport(firstWorker);
    await firstClient.connect();
    await firstClient.send(initializeRequest());
    const initialized = await nextEvent(firstClient);
    const approval = await nextEvent(firstClient);
    if (!initialized.done) await firstClient.acknowledge(initialized.value);
    if (approval.done) throw new Error("Expected a durable approval event.");
    expect(approval.value).toMatchObject({
      message: { kind: "rpc-request", rpc: { id: "approval-1" } },
    });
    const responseId = `server-response:${approval.value.eventId}:${APPROVAL_SCOPE_DIGEST}`;
    await vi.waitFor(async () => expect((await firstWorker.health()).state).toBe("failed"));
    await firstClient.close();
    await firstWorker.stop();

    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) write({ id: rpc.id, result: {} });',
      '  else write({ method: "warning", params: { threadId: "thread-1", turnId: "turn-1", message: "response for old request was dispatched" } });',
      '});',
    ].join("\n"), { mode: 0o600 });
    const restartedWorker = gateway();
    await restartedWorker.start();
    const restartedClient = transport(restartedWorker);
    try {
      await restartedClient.connect();
      const replayedApproval = await nextEvent(restartedClient);
      expect(replayedApproval.value).toMatchObject({
        message: { kind: "rpc-request", rpc: { id: "approval-1" } },
      });

      await expect(restartedClient.send(approvalResponse(responseId))).resolves.toBeUndefined();
      if (!replayedApproval.done) await restartedClient.acknowledge(replayedApproval.value);
      await restartedClient.send(initializeRequest("initialize-after-old-request"));
      const next = await nextEvent(restartedClient);
      expect(next.value).toMatchObject({
        message: {
          kind: "rpc-response",
          rpc: { id: "initialize-after-old-request", result: {} },
        },
      });
      const receipt = (await readFile(
        path.join(context.transportAudit, "gateway-requests.jsonl"),
        "utf8",
      )).trim().split("\n").map((line) => JSON.parse(line) as {
        payload: { clientRequestId: string; status: string };
      }).findLast((entry) => entry.payload.clientRequestId === responseId);
      expect(receipt?.payload).toMatchObject({
        clientRequestId: responseId,
        status: "accepted",
      });
    } finally {
      await restartedClient.close();
      await restartedWorker.stop();
    }
  }, 15_000);

  it("does not replay the same uncertain server response into a restarted child", async () => {
    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (rpc.method) {',
      '    write({ id: rpc.id, result: {} });',
      '    write({ method: "item/commandExecution/requestApproval", id: "approval-1", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1, environmentId: null, command: "pwd" } });',
      '  } else process.exit(42);',
      '});',
    ].join("\n"), { mode: 0o600 });
    const firstWorker = gateway();
    await firstWorker.start();
    const firstClient = transport(firstWorker);
    await firstClient.connect();
    await firstClient.send(initializeRequest());
    const initialized = await nextEvent(firstClient);
    const approval = await nextEvent(firstClient);
    if (!initialized.done) await firstClient.acknowledge(initialized.value);
    if (approval.done) throw new Error("Expected a durable approval event.");
    await firstClient.acknowledge(approval.value);
    const responseId = `server-response:${approval.value.eventId}:${APPROVAL_SCOPE_DIGEST}`;
    await vi.waitFor(async () => {
      const cursor = JSON.parse(await readFile(
        path.join(context.transportAudit, "gateway-events.jsonl.delivery.json"),
        "utf8",
      )) as { sequence: number };
      expect(cursor.sequence).toBe(2);
    });
    const firstSubmission = firstClient.send(approvalResponse(responseId)).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(async () => expect((await firstWorker.health()).state).toBe("failed"));
    await firstClient.close();
    expect(await firstSubmission).toBeInstanceOf(Error);
    await firstWorker.stop();

    const compactingGatewayJournal = new FileTransportEventJournal({
      filePath: path.join(context.transportAudit, "gateway-events.jsonl"),
      lockManager: new ResourceLockManager({
        rootDirectory: path.join(context.transportAudit, "gateway-locks"),
      }),
      maxRetainedDeliveredEvents: 1,
    });
    const compactingEvent = {
      eventId: "44444444-4444-4444-8444-444444444444",
      sequence: 3,
      occurredAt: new Date().toISOString(),
      message: {
        kind: "rpc-notification" as const,
        rpc: {
          method: "item/agentMessage/delta" as const,
          params: {
            threadId: "unrelated-thread",
            turnId: "unrelated-turn",
            itemId: "unrelated-item",
            delta: "unrelated progress",
          },
        },
      },
    };
    const compactingClientJournal = new FileTransportEventJournal({
      filePath: path.join(context.transportAudit, "test-client-events.jsonl"),
      lockManager: new ResourceLockManager({
        rootDirectory: path.join(context.transportAudit, "test-client-locks"),
      }),
      maxRetainedDeliveredEvents: 1,
    });
    await compactingGatewayJournal.append(compactingEvent);
    await compactingGatewayJournal.markDelivered(compactingEvent);
    await compactingClientJournal.append(compactingEvent);
    await compactingClientJournal.markDelivered(compactingEvent);
    expect((await compactingGatewayJournal.readEvents()).map((event) => event.sequence)).toEqual([3]);
    expect((await compactingClientJournal.readEvents()).map((event) => event.sequence)).toEqual([3]);

    await writeFile(fakeServer, [
      'import { createInterface } from "node:readline";',
      'const lines = createInterface({ input: process.stdin });',
      'const write = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);',
      'lines.on("line", (line) => {',
      '  const rpc = JSON.parse(line);',
      '  if (!rpc.method) write({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "agent-1", delta: "recovered approval" } });',
      '  else write({ id: rpc.id, result: {} });',
      '});',
    ].join("\n"), { mode: 0o600 });
    const restartedWorker = gateway();
    await restartedWorker.start();
    const restartedClient = transport(restartedWorker);
    try {
      await restartedClient.connect();
      await expect(restartedClient.send(approvalResponse(responseId))).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const durableEvents = (await readFile(
        path.join(context.transportAudit, "gateway-events.jsonl"),
        "utf8",
      )).trim().split("\n").map((line) => JSON.parse(line) as {
        payload: { message: { kind: string; rpc: { method?: string; params?: { threadId?: string } } } };
      });
      expect(durableEvents.filter((entry) =>
        entry.payload.message.kind === "rpc-notification"
        && entry.payload.message.rpc.method === "item/agentMessage/delta"
        && entry.payload.message.rpc.params?.threadId === "thread-1"
      )).toHaveLength(0);
    } finally {
      await restartedClient.close();
      await restartedWorker.stop();
    }
  }, 15_000);
});
