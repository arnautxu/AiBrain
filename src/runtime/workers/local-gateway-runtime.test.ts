import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTransportEventJournal, WebSocketAppServerTransport } from "@/runtime/transport";
import {
  NodeWebSocketFactory,
  PrivateWorkerGateway,
  workerEgressEnvironment,
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
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 100,
      reconnectBaseDelayMs: 5,
      reconnectMaxDelayMs: 20,
      reconnectJitterRatio: 0,
    });
  }

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
      if (!approval.done) await client.acknowledge(approval.value);

      let confirmed = false;
      const submission = client.send(approvalResponse()).then(() => { confirmed = true; });
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

  it("retries the same server response after a child crash before processing evidence", async () => {
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
    if (!approval.done) await firstClient.acknowledge(approval.value);
    await vi.waitFor(async () => {
      const cursor = JSON.parse(await readFile(
        path.join(context.transportAudit, "gateway-events.jsonl.delivery.json"),
        "utf8",
      )) as { sequence: number };
      expect(cursor.sequence).toBe(2);
    });
    const firstSubmission = firstClient.send(approvalResponse()).then(
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
      await expect(restartedClient.send(approvalResponse())).resolves.toBeUndefined();
      const progress = await nextEvent(restartedClient);
      expect(progress.value).toMatchObject({
        message: { kind: "rpc-notification", rpc: { params: { delta: "recovered approval" } } },
      });
    } finally {
      await restartedClient.close();
      await restartedWorker.stop();
    }
  });
});
