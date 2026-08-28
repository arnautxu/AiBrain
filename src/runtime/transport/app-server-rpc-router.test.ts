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
  push(value: AppServerEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  get pending() { return this.values.length; }
  [Symbol.asyncIterator](): AsyncIterator<AppServerEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
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
  it("returns a typed timeout so callers can recover without resubmitting a turn", async () => {
    const transport = new FakeTransport();
    const router = new AppServerRpcRouter(transport);
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
    await router.close();
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
});
