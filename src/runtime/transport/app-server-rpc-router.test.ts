import { describe, expect, it, vi } from "vitest";
import type {
  AppServerEvent,
  AppServerRequest,
  AppServerTransport,
  TransportHealth,
} from "@/runtime/transport/contracts";
import { AppServerRpcRouter } from "@/runtime/transport/app-server-rpc-router";

class EventQueue implements AsyncIterable<AppServerEvent> {
  private values: AppServerEvent[] = [];
  private waiters: Array<(value: IteratorResult<AppServerEvent>) => void> = [];
  push(value: AppServerEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
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
    expect(transport.sent.at(-1)).toMatchObject({
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
});
