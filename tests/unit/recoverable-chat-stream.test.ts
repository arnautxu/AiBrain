import { describe, expect, it, vi } from "vitest";
import {
  consumeRecoverableChatStream,
  type ChatStreamRecoveryScheduler,
} from "@/ui/recoverable-chat-stream";
import { createChatReattachRequest } from "@/ui/chat-reattach-request";
import type { ChatStreamEvent } from "@/lib/chat-contract";

class ControlledScheduler {
  nowMs = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  readonly api: ChatStreamRecoveryScheduler = {
    now: () => this.nowMs,
    setTimeout: (callback, delayMs) => {
      const handle = this.nextHandle++;
      this.timers.set(handle, { at: this.nowMs + delayMs, callback });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => { this.timers.delete(handle as unknown as number); },
    random: () => 0.5,
  };

  advance(milliseconds: number) {
    this.nowMs += milliseconds;
    this.runDue();
  }

  runNext() {
    const next = [...this.timers.entries()].sort(([, left], [, right]) => left.at - right.at)[0];
    if (!next) throw new Error("No timer is pending");
    this.timers.delete(next[0]);
    this.nowMs = Math.max(this.nowMs, next[1].at);
    next[1].callback();
  }

  private runDue() {
    let due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.nowMs)
      .sort(([, left], [, right]) => left.at - right.at)[0];
    while (due) {
      this.timers.delete(due[0]);
      due[1].callback();
      due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.nowMs)
        .sort(([, left], [, right]) => left.at - right.at)[0];
    }
  }
}

const encoder = new TextEncoder();

function response(events: ChatStreamEvent[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      events.forEach((event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)));
      controller.close();
    },
  }));
}

function controlledResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({ start(next) { controller = next; } });
  return {
    response: new Response(body),
    emit(event: ChatStreamEvent) { controller?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); },
    close() { controller?.close(); },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("recoverable chat stream", () => {
  it("observes idle beyond three seconds without showing recovery or closing a healthy stream", async () => {
    const scheduler = new ControlledScheduler();
    const source = controlledResponse();
    const measurements: unknown[] = [];
    const states: unknown[] = [];
    let receivedDelta: (() => void) | null = null;
    const received = new Promise<void>((resolve) => { receivedDelta = resolve; });
    const run = consumeRecoverableChatStream({
      request: vi.fn(async () => source.response),
      signal: new AbortController().signal,
      onEvent: (event) => { if (event.type === "delta") receivedDelta?.(); },
      onRecoveryState: (state) => states.push(state),
      onMeasurement: (measurement) => measurements.push(measurement),
      scheduler: scheduler.api,
      startedAt: 0,
    });
    source.emit({ type: "delta", value: "visible only in the message" });
    await received;
    scheduler.advance(3_001);
    expect(states).toEqual([]);
    expect(measurements.at(-1)).toMatchObject({ idleObservedAtMs: 3001, recoveryAttempts: 0, bannerShownAtMs: null });

    source.emit({ type: "done" });
    source.close();
    await run;
  });

  it("treats an EOF at about three seconds as recovery and reattaches through a snapshot", async () => {
    const scheduler = new ControlledScheduler();
    const first = controlledResponse();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => fetcher.mock.calls.length === 1
      ? first.response
      : response([{ type: "snapshot", message: {
        id: "assistant-turn", role: "assistant", content: "snapshot text", status: "streaming", createdAt: "2026-08-28T12:00:00.000Z",
        activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [], sources: [], toolResults: [],
      } }, { type: "done" }]));
    const request = createChatReattachRequest(JSON.stringify({ threadId: "thread-current", assistantMessageId: "assistant-turn", userMessageId: "user-current" }), fetcher);
    const measurements: unknown[] = [];
    const states: unknown[] = [];
    const events: ChatStreamEvent[] = [];
    const run = consumeRecoverableChatStream({
      request,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      onRecoveryState: (state) => states.push(state),
      onMeasurement: (measurement) => measurements.push(measurement),
      scheduler: scheduler.api,
      startedAt: 0,
    });
    first.emit({ type: "delta", value: "first fragment" });
    await flush();
    scheduler.advance(3_000);
    first.close();
    await flush();
    expect(measurements.at(-1)).toMatchObject({ closedAtMs: 3000, closeCode: null, closeReason: "stream-ended", recoveryAttempts: 1 });
    scheduler.runNext();
    await run;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.body)).toEqual([
      fetcher.mock.calls[0]?.[1]?.body,
      fetcher.mock.calls[0]?.[1]?.body,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      threadId: "thread-current", assistantMessageId: "assistant-turn", userMessageId: "user-current",
    });
    expect(events.map((event) => event.type)).toEqual(["delta", "snapshot", "done"]);
    expect(states).toContainEqual({ state: "recovering", attempt: 1 });
    expect(states).toContainEqual({ state: "recovered" });
    expect(states).toContainEqual({ state: "idle" });
    expect(JSON.stringify(measurements.at(-1))).not.toContain("snapshot text");
  });

  it("backs off a retryable worker-restart response without sharing state between consumers", async () => {
    const schedulerA = new ControlledScheduler();
    const schedulerB = new ControlledScheduler();
    const first = vi.fn(async () => first.mock.calls.length === 1
      ? new Response("restart", { status: 503 })
      : response([{ type: "snapshot", message: {
        id: "turn-a", role: "assistant", content: "a", status: "streaming", createdAt: "2026-08-28T12:00:00.000Z",
        activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [], sources: [], toolResults: [],
      } }, { type: "done" }]));
    const second = vi.fn(async () => response([{ type: "done" }]));
    const eventsA: ChatStreamEvent[] = [];
    const eventsB: ChatStreamEvent[] = [];
    const runA = consumeRecoverableChatStream({ request: first, signal: new AbortController().signal, onEvent: (event) => eventsA.push(event), onRecoveryState: () => undefined, onMeasurement: () => undefined, scheduler: schedulerA.api, startedAt: 0 });
    const runB = consumeRecoverableChatStream({ request: second, signal: new AbortController().signal, onEvent: (event) => eventsB.push(event), onRecoveryState: () => undefined, onMeasurement: () => undefined, scheduler: schedulerB.api, startedAt: 0 });
    await flush();
    schedulerA.runNext();
    // A separate active identity/turn has its own runner and is never touched by A's retry.
    await runB;
    await runA;
    expect(first).toHaveBeenCalledTimes(2);
    expect(eventsA.map((event) => event.type)).toEqual(["snapshot", "done"]);
    expect(eventsB).toEqual([{ type: "done" }]);
  });
});
