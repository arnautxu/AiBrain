import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  TransportHealth,
} from "@/runtime/transport/contracts";
import {
  AppServerRequestTimeoutError,
  AppServerRpcRouter,
} from "@/runtime/transport/app-server-rpc-router";

class EventQueue implements AsyncIterable<AppServerEvent> {
  private values: AppServerEvent[] = [];
  private waiters: Array<(value: IteratorResult<AppServerEvent>) => void> = [];
  private closed = false;
  push(value: AppServerEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }
  get pending() { return this.values.length; }
  [Symbol.asyncIterator](): AsyncIterator<AppServerEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeTransport implements AppServerTransport {
  readonly sent: AppServerRequest[] = [];
  readonly acknowledged: AppServerEvent[] = [];
  readonly queue = new EventQueue();
  async connect() {}
  async send(request: AppServerRequest) { this.sent.push(request); }
  events() { return this.queue; }
  async acknowledge(event: AppServerEvent) { this.acknowledged.push(event); }
  async health(): Promise<TransportHealth> {
    return {
      healthy: true,
      state: "connected",
      endpoint: "ws://127.0.0.1",
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

function event(sequence: number, message: AppServerEvent["message"]): AppServerEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    occurredAt: "2026-08-27T00:00:00.000Z",
    message,
  };
}

describe("AppServerRpcRouter", () => {
  it("stays failed after an unexpected EOF so a cached initializer cannot mask a dead transport", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    const failed = vi.fn();
    await router.start();
    router.registerTurn("thread-a", "local-a", {
      onNotification: vi.fn(),
      onServerRequest: vi.fn(),
      onFailure: failed,
    });

    transport.queue.close();
    await vi.waitFor(() => expect(router.failed).toBe(true));

    expect(failed).toHaveBeenCalledOnce();
    expect(router.hasActiveTurn("thread-a", "local-a")).toBe(false);
    await expect(router.start()).rejects.toThrow("event stream closed unexpectedly");
    await expect(router.request({ method: "account/read", id: "after-eof", params: { refreshToken: false } }))
      .rejects.toThrow("event stream closed unexpectedly");
    await router.close();
  });

  it("returns a typed timeout so callers can recover without resubmitting a turn", async () => {
    const transport = new FakeTransport();
    const metrics = vi.fn();
    const router = new AppServerRpcRouter(transport, { onRequestMetric: metrics });
    const result = router.request(
      { method: "turn/start", id: "slow-turn", params: { threadId: "thread-a", input: [] } },
      5,
    );

    await expect(result).rejects.toMatchObject({
      name: "AppServerRequestTimeoutError",
      method: "turn/start",
      requestId: "slow-turn",
      timeoutMs: 5,
    } satisfies Partial<AppServerRequestTimeoutError>);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/start",
      requestId: "slow-turn",
      outcome: "timeout",
      requestAcceptedMs: expect.any(Number),
      totalMs: expect.any(Number),
      activeTurnsAtStart: 0,
      pendingRequestsAtStart: 0,
    }));
    await router.close();
  });

  it("delivers a late response to the original timeout without dispatching a second request", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    const result = router.request(
      { method: "thread/read", id: "late-read", params: { threadId: "thread-a", includeTurns: true } },
      5,
    );
    const timeout = await result.catch((error: unknown) => error);
    expect(timeout).toBeInstanceOf(AppServerRequestTimeoutError);
    expect(transport.sent).toHaveLength(1);
    await expect(router.request(
      { method: "thread/read", id: "late-read", params: { threadId: "thread-a", includeTurns: true } },
      50,
    )).rejects.toThrow(/late response/u);
    expect(transport.sent).toHaveLength(1);

    transport.queue.push(event(1, {
      kind: "rpc-response",
      rpc: { id: "late-read", result: { thread: { id: "thread-a", turns: [] } } },
    }));

    await expect((timeout as AppServerRequestTimeoutError).lateResponse).resolves.toEqual({
      thread: { id: "thread-a", turns: [] },
    });
    expect(transport.sent).toHaveLength(1);
    await vi.waitFor(() => expect(transport.acknowledged).toHaveLength(1));
    await router.close();
  });

  it("applies the request deadline while the private worker is still connecting", async () => {
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => { releaseConnect = resolve; });
    class BlockedConnectTransport extends FakeTransport {
      override async connect() { await connectGate; }
    }
    const transport = new BlockedConnectTransport();
    const metrics = vi.fn();
    const router = new AppServerRpcRouter(transport, { onRequestMetric: metrics });
    const result = router.request(
      { method: "thread/read", id: "blocked-connect", params: { threadId: "thread-a", includeTurns: true } },
      5,
    );

    await expect(result).rejects.toBeInstanceOf(AppServerRequestTimeoutError);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "blocked-connect",
      outcome: "timeout",
      requestAcceptedMs: null,
    }));
    releaseConnect();
    await router.close();
  });

  it("enforces the request timeout even when transport admission itself is blocked", async () => {
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    class BlockedAdmissionTransport extends FakeTransport {
      override async send(request: AppServerRequest) {
        this.sent.push(request);
        await sendGate;
      }
    }
    const transport = new BlockedAdmissionTransport();
    const router = new AppServerRpcRouter(transport);
    const result = router.request(
      { method: "thread/read", id: "blocked-admission", params: { threadId: "thread-a", includeTurns: true } },
      5,
    );

    await expect(result).rejects.toMatchObject({
      name: "AppServerRequestTimeoutError",
      method: "thread/read",
      requestId: "blocked-admission",
    });
    releaseSend();
    await router.close();
  });

  it("releases a blocked transport admission when the router closes", async () => {
    const sendGate = new Promise<void>(() => undefined);
    class BlockedAdmissionTransport extends FakeTransport {
      override async send(request: AppServerRequest) {
        this.sent.push(request);
        await sendGate;
      }
    }
    const transport = new BlockedAdmissionTransport();
    const router = new AppServerRpcRouter(transport);
    const result = router.request(
      { method: "thread/read", id: "close-blocked-admission", params: { threadId: "thread-a", includeTurns: true } },
      30_000,
    );
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));

    await router.close();

    await expect(result).rejects.toThrow("App Server router closed");
  });

  it("resolves concurrent RPC responses by id even when they arrive out of order", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    const first = router.request({ method: "thread/read", id: "request-one", params: { threadId: "thread-a", includeTurns: false } });
    const second = router.request({ method: "thread/read", id: "request-two", params: { threadId: "thread-b", includeTurns: false } });
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2));

    transport.queue.push(event(1, { kind: "rpc-response", rpc: { id: "request-two", result: { thread: { id: "thread-b" } } } }));
    transport.queue.push(event(2, { kind: "rpc-response", rpc: { id: "request-one", result: { thread: { id: "thread-a" } } } }));
    await expect(second).resolves.toEqual({ thread: { id: "thread-b" } });
    await expect(first).resolves.toEqual({ thread: { id: "thread-a" } });
    await vi.waitFor(() => expect(transport.acknowledged).toHaveLength(2));
    await router.close();
  });

  it("does not resolve or ACK an RPC response until its durable projection hook completes", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    let releaseProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
    const projected = vi.fn(async () => projectionGate);
    const result = router.request(
      { method: "thread/read", id: "durable-response", params: { threadId: "thread-a", includeTurns: false } },
      30_000,
      projected,
    );
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    transport.queue.push(event(1, {
      kind: "rpc-response",
      rpc: { id: "durable-response", result: { thread: { id: "thread-a" } } },
    }));
    await vi.waitFor(() => expect(projected).toHaveBeenCalledOnce());
    expect(transport.acknowledged).toHaveLength(0);
    releaseProjection();
    await expect(result).resolves.toEqual({ thread: { id: "thread-a" } });
    await vi.waitFor(() => expect(transport.acknowledged).toHaveLength(1));
    await router.close();
  });

  it("keeps the request deadline active while durable response projection is blocked", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    let releaseProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
    const projected = vi.fn(async () => projectionGate);
    const result = router.request(
      { method: "thread/read", id: "projection-timeout", params: { threadId: "thread-a", includeTurns: false } },
      500,
      projected,
    );
    const timedOut = expect(result).rejects.toBeInstanceOf(AppServerRequestTimeoutError);
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    transport.queue.push(event(1, {
      kind: "rpc-response",
      rpc: { id: "projection-timeout", result: { thread: { id: "thread-a" } } },
    }));
    await vi.waitFor(() => expect(projected).toHaveBeenCalledOnce());

    await timedOut;
    expect(transport.acknowledged).toHaveLength(0);
    releaseProjection();
    await vi.waitFor(() => expect(transport.acknowledged).toHaveLength(1));
    await router.close();
  });

  it("keeps another thread responsive while one response projection is blocked", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    let releaseProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
    const first = router.request(
      { method: "thread/read", id: "blocked-thread-a", params: { threadId: "thread-a", includeTurns: true } },
      30_000,
      async () => projectionGate,
    );
    const second = router.request(
      { method: "thread/read", id: "free-thread-b", params: { threadId: "thread-b", includeTurns: true } },
      1_000,
    );
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2));
    transport.queue.push(event(1, {
      kind: "rpc-response",
      rpc: { id: "blocked-thread-a", result: { thread: { id: "thread-a", turns: [] } } },
    }));
    transport.queue.push(event(2, {
      kind: "rpc-response",
      rpc: { id: "free-thread-b", result: { thread: { id: "thread-b", turns: [] } } },
    }));

    await expect(second).resolves.toEqual({ thread: { id: "thread-b", turns: [] } });
    expect(transport.acknowledged).toHaveLength(0);
    releaseProjection();
    await expect(first).resolves.toEqual({ thread: { id: "thread-a", turns: [] } });
    await vi.waitFor(() => expect(transport.acknowledged.map(({ sequence }) => sequence)).toEqual([1, 2]));
    await router.close();
  });

  it("routes notifications and server approvals only to their bound thread and turn", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    const aNotification = vi.fn();
    const bNotification = vi.fn();
    const aApproval = vi.fn(async () => ({ decision: "accept" }));
    const bApproval = vi.fn(async () => ({ decision: "decline" }));
    const first = router.registerTurn("thread-a", "local-a", {
      onNotification: aNotification,
      onServerRequest: aApproval,
      onFailure: vi.fn(),
    });
    const second = router.registerTurn("thread-b", "local-b", {
      onNotification: bNotification,
      onServerRequest: bApproval,
      onFailure: vi.fn(),
    });
    first.bindRuntimeTurn("turn-a");
    second.bindRuntimeTurn("turn-b");

    transport.queue.push(event(1, {
      kind: "rpc-notification",
      rpc: { method: "item/agentMessage/delta", params: { threadId: "thread-b", turnId: "turn-b", itemId: "item-b", delta: "B" } },
    }));
    transport.queue.push(event(2, {
      kind: "rpc-request",
      rpc: {
        method: "item/commandExecution/requestApproval",
        id: "approval-a",
        params: {
          threadId: "thread-a",
          turnId: "turn-a",
          itemId: "item-a",
          startedAtMs: 1,
          environmentId: null,
          command: "pwd",
        },
      },
    }));
    await vi.waitFor(() => expect(transport.acknowledged).toHaveLength(2));
    expect(aNotification).not.toHaveBeenCalled();
    expect(bNotification).toHaveBeenCalledOnce();
    expect(aApproval).toHaveBeenCalledOnce();
    expect(bApproval).not.toHaveBeenCalled();
    const scopeDigest = createHash("sha256")
      .update(JSON.stringify(["thread-a", "turn-a"]))
      .digest("hex");
    expect(transport.sent.at(-1)).toMatchObject({
      clientRequestId: `server-response:event-2:${scopeDigest}`,
      kind: "rpc-response",
      rpc: { id: "approval-a", result: { decision: "accept" } },
    });
    first.dispose();
    second.dispose();
    await router.close();
  });

  it("rejects unowned server requests without exposing them to another active turn", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    const handler = vi.fn(async () => ({ decision: "accept" }));
    router.registerTurn("thread-a", "local-a", {
      onNotification: vi.fn(),
      onServerRequest: handler,
      onFailure: vi.fn(),
    });
    transport.queue.push(event(1, {
      kind: "rpc-request",
      rpc: {
        method: "item/fileChange/requestApproval",
        id: "approval-other",
        params: {
          threadId: "thread-other",
          turnId: "turn-other",
          itemId: "item-other",
          reason: null,
          grantRoot: null,
          startedAtMs: 1,
        },
      },
    }));
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    expect(handler).not.toHaveBeenCalled();
    expect(transport.sent[0]).toMatchObject({
      kind: "rpc-response",
      rpc: { id: "approval-other", error: { code: -32602 } },
    });
    await router.close();
  });

  it("returns an explicit error for a server request from the wrong turn on an owned thread", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    const handler = vi.fn(async () => ({ decision: "accept" }));
    router.registerTurn("thread-a", "local-a", {
      onNotification: vi.fn(),
      onServerRequest: handler,
      onFailure: vi.fn(),
    }).bindRuntimeTurn("turn-a");
    transport.queue.push(event(1, {
      kind: "rpc-request",
      rpc: {
        method: "item/fileChange/requestApproval",
        id: "approval-wrong-turn",
        params: {
          threadId: "thread-a",
          turnId: "turn-b",
          itemId: "item-other",
          reason: null,
          grantRoot: null,
          startedAtMs: 1,
        },
      },
    }));
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    expect(handler).not.toHaveBeenCalled();
    expect(transport.sent[0]).toMatchObject({
      kind: "rpc-response",
      rpc: { id: "approval-wrong-turn", error: { code: -32602, message: expect.stringContaining("does not own") } },
    });
    await router.close();
  });

  it("does not rebind a new local turn to a delayed notification from the previous runtime turn", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    let releasePrevious!: () => void;
    const previousGate = new Promise<void>((resolve) => { releasePrevious = resolve; });
    const previousNotification = vi.fn(async () => previousGate);
    const previous = router.registerTurn("thread-sequential", "local-old", {
      onNotification: previousNotification,
      onServerRequest: vi.fn(),
      onFailure: vi.fn(),
    });
    previous.bindRuntimeTurn("turn-old");

    transport.queue.push(event(1, {
      kind: "rpc-notification",
      rpc: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-sequential",
          turnId: "turn-old",
          itemId: "item-old-1",
          delta: "old",
        },
      },
    }));
    await vi.waitFor(() => expect(previousNotification).toHaveBeenCalledOnce());
    transport.queue.push(event(2, {
      kind: "rpc-notification",
      rpc: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-sequential",
          turnId: "turn-old",
          itemId: "item-old-2",
          delta: "late-old",
        },
      },
    }));
    await vi.waitFor(() => expect(transport.queue.pending).toBe(0));

    previous.dispose();
    const currentNotification = vi.fn();
    const current = router.registerTurn("thread-sequential", "local-new", {
      onNotification: currentNotification,
      onServerRequest: vi.fn(),
      onFailure: vi.fn(),
    });
    releasePrevious();
    await vi.waitFor(() => expect(transport.acknowledged.map((item) => item.sequence)).toEqual([1, 2]));

    expect(previousNotification).toHaveBeenCalledOnce();
    expect(currentNotification).not.toHaveBeenCalled();
    expect(() => current.bindRuntimeTurn("turn-new")).not.toThrow();
    current.dispose();
    await router.close();
  });

  it("waits for the explicit turn/start binding before routing post-resume turn notifications", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    const notification = vi.fn();
    const registration = router.registerTurn("thread-resumed", "local-current", {
      onNotification: notification,
      onServerRequest: vi.fn(),
      onFailure: vi.fn(),
    });

    transport.queue.push(event(1, {
      kind: "rpc-notification",
      rpc: {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-resumed",
          turnId: "turn-previous",
          tokenUsage: {
            total: { totalTokens: 10, inputTokens: 5, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 },
            last: { totalTokens: 10, inputTokens: 5, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 },
            modelContextWindow: 1000,
          },
        },
      },
    }));
    await vi.waitFor(() => expect(transport.queue.pending).toBe(0));
    expect(transport.acknowledged).toHaveLength(0);

    expect(() => registration.bindRuntimeTurn("turn-current")).not.toThrow();
    await vi.waitFor(() => expect(transport.acknowledged.map((item) => item.sequence)).toEqual([1]));
    expect(notification).not.toHaveBeenCalled();

    transport.queue.push(event(2, {
      kind: "rpc-notification",
      rpc: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-resumed",
          turnId: "turn-current",
          itemId: "item-current",
          delta: "current",
        },
      },
    }));
    await vi.waitFor(() => expect(notification).toHaveBeenCalledOnce());
    registration.dispose();
    await router.close();
  });

  it("keeps another thread streaming while an approval is pending and ACKs in order", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
    await router.start();
    let releaseApproval!: () => void;
    const approvalGate = new Promise<void>((resolve) => { releaseApproval = resolve; });
    const otherNotification = vi.fn();
    router.registerTurn("thread-approval", "local-approval", {
      onNotification: vi.fn(),
      onServerRequest: async () => {
        await approvalGate;
        return { decision: "accept" };
      },
      onFailure: vi.fn(),
    }).bindRuntimeTurn("turn-approval");
    router.registerTurn("thread-stream", "local-stream", {
      onNotification: otherNotification,
      onServerRequest: vi.fn(),
      onFailure: vi.fn(),
    }).bindRuntimeTurn("turn-stream");

    transport.queue.push(event(1, {
      kind: "rpc-request",
      rpc: {
        method: "item/commandExecution/requestApproval",
        id: "approval-pending",
        params: {
          threadId: "thread-approval",
          turnId: "turn-approval",
          itemId: "item-approval",
          startedAtMs: 1,
          environmentId: null,
          command: "pwd",
        },
      },
    }));
    transport.queue.push(event(2, {
      kind: "rpc-notification",
      rpc: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-stream",
          turnId: "turn-stream",
          itemId: "item-stream",
          delta: "continues",
        },
      },
    }));

    await vi.waitFor(() => expect(otherNotification).toHaveBeenCalledOnce());
    expect(transport.acknowledged).toHaveLength(0);
    releaseApproval();
    await vi.waitFor(() => expect(transport.acknowledged.map((item) => item.sequence)).toEqual([1, 2]));
    await router.close();
  });

  it("runs three chats and opens a fourth while one tool is blocked, then remains usable after a read timeout", async () => {
    const transport = new FakeTransport();
    const metrics = vi.fn();
    const router = new AppServerRpcRouter(transport, { onRequestMetric: metrics });
    await router.start();
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
    const notifications = [vi.fn(), vi.fn(), vi.fn()];
    ["thread-a", "thread-b", "thread-c"].forEach((threadId, index) => {
      router.registerTurn(threadId, `local-${threadId}`, {
        onNotification: notifications[index]!,
        onServerRequest: index === 0
          ? async () => { await toolGate; return { success: true }; }
          : vi.fn(async () => ({ success: true })),
        onFailure: vi.fn(),
      }).bindRuntimeTurn(`turn-${threadId.at(-1)}`);
    });

    transport.queue.push(event(1, {
      kind: "rpc-request",
      rpc: {
        method: "item/tool/call",
        id: "tool-create",
        params: {
          threadId: "thread-a",
          turnId: "turn-a",
          callId: "tool-create",
          namespace: "aibrain_documents",
          tool: "create",
          arguments: {},
        },
      },
    }));
    transport.queue.push(event(2, {
      kind: "rpc-notification",
      rpc: { method: "item/agentMessage/delta", params: { threadId: "thread-b", turnId: "turn-b", itemId: "b", delta: "B" } },
    }));
    transport.queue.push(event(3, {
      kind: "rpc-notification",
      rpc: { method: "item/agentMessage/delta", params: { threadId: "thread-c", turnId: "turn-c", itemId: "c", delta: "C" } },
    }));
    await vi.waitFor(() => {
      expect(notifications[1]).toHaveBeenCalledOnce();
      expect(notifications[2]).toHaveBeenCalledOnce();
    });

    const newChat = router.request({
      method: "thread/start",
      id: "new-chat",
      params: { cwd: "/private/workspace", approvalPolicy: "never", sandbox: "read-only" },
    }, 1_000);
    await vi.waitFor(() => expect(transport.sent.some(({ clientRequestId }) => clientRequestId === "new-chat")).toBe(true));
    transport.queue.push(event(4, {
      kind: "rpc-response",
      rpc: { id: "new-chat", result: { thread: { id: "thread-d" } } },
    }));
    await expect(newChat).resolves.toEqual({ thread: { id: "thread-d" } });

    await expect(router.request({
      method: "thread/read",
      id: "bounded-read",
      params: { threadId: "missing", includeTurns: true },
    }, 5)).rejects.toBeInstanceOf(AppServerRequestTimeoutError);
    const trivial = router.request({ method: "account/read", id: "trivial", params: { refreshToken: false } }, 1_000);
    await vi.waitFor(() => expect(transport.sent.some(({ clientRequestId }) => clientRequestId === "trivial")).toBe(true));
    transport.queue.push(event(5, {
      kind: "rpc-response",
      rpc: { id: "trivial", result: { account: { type: "chatgpt" } } },
    }));
    await expect(trivial).resolves.toEqual({ account: { type: "chatgpt" } });

    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ requestId: "bounded-read", outcome: "timeout" }));
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ requestId: "trivial", outcome: "completed" }));
    releaseTool();
    await vi.waitFor(() => expect(transport.acknowledged.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5]));
    await router.close();
  });
});
