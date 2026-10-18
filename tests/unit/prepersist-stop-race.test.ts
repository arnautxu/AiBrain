import { afterEach, expect, it, vi } from "vitest";
import { PendingTurnStop, stopControlAccepted } from "@/ui/pending-turn-stop";
import { consumeRecoverableChatStream } from "@/ui/recoverable-chat-stream";

afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
const scheduler = { now: () => Date.now(), setTimeout, clearTimeout, random: () => 0.5 };

it("a rejected Stop before admission pauses retries and never establishes a terminal result", async () => {
  const sendControl = vi.fn(async () => false), onPause = vi.fn(), onBusy = vi.fn();
  const stop = new PendingTurnStop({ sendControl, onPause, onBusy });
  await stop.requestStop();
  expect(stop.retriesPaused).toBe(true); expect(stop.terminalObserved).toBe(false);
  expect(onPause).toHaveBeenCalledOnce(); expect(sendControl).toHaveBeenCalledOnce();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});

it.each([false, true])("late admission while control is in flight schedules at most one bound follow-up (first accepted=%s)", async accepted => {
  const first = deferred<boolean>();
  const sender = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(false);
  const stop = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  const pending = stop.requestStop(); await flush();
  stop.confirmAdmission(); stop.confirmAdmission();
  first.resolve(accepted); await pending; await flush();
  expect(sender).toHaveBeenCalledTimes(accepted ? 1 : 2);
  expect(stop.retriesPaused).toBe(false); expect(stop.terminalObserved).toBe(false);
});

it("each Stop request records admission at dispatch, even when the first response arrives after admission", async () => {
  const first = deferred<boolean>();
  const sender = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(false);
  const stop = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  const pending = stop.requestStop(); await flush();
  expect(sender.mock.calls).toEqual([[{ admissionConfirmed: false }]]);
  stop.confirmAdmission();
  first.resolve(false); await pending; await flush();
  expect(sender.mock.calls).toEqual([[{ admissionConfirmed: false }], [{ admissionConfirmed: true }]]);
  expect(stop.terminalObserved).toBe(false);
});

it("late admission after a failed control retries once; a failed follow-up never loops or invents Stop", async () => {
  const sender = vi.fn(async () => false);
  const stop = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  await stop.requestStop(); stop.confirmAdmission(); await flush();
  expect(sender).toHaveBeenCalledTimes(2); expect(stop.terminalObserved).toBe(false);
  stop.confirmAdmission(); await flush(); expect(sender).toHaveBeenCalledTimes(2);
});

it("duplicate clicks coalesce, and terminal/disposal races do not dispatch a stale control", async () => {
  const sender = vi.fn(async () => true);
  const stop = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  const pending = stop.requestStop(); stop.requestStop(); stop.observeTerminal(); await pending;
  expect(sender).not.toHaveBeenCalled(); expect(stop.terminalObserved).toBe(true);
  const stale = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  const queued = stale.requestStop(); stale.dispose(); stale.confirmAdmission(); await queued;
  expect(sender).not.toHaveBeenCalled();
});

it("two turn coordinators cannot transfer a pending Stop to another turn", async () => {
  const senderA = vi.fn(async () => false), senderB = vi.fn(async () => true);
  const a = new PendingTurnStop({ sendControl: senderA, onPause: vi.fn(), onBusy: vi.fn() });
  const b = new PendingTurnStop({ sendControl: senderB, onPause: vi.fn(), onBusy: vi.fn() });
  await a.requestStop(); b.confirmAdmission(); await flush();
  expect(senderA).toHaveBeenCalledOnce(); expect(senderB).not.toHaveBeenCalled();
  a.dispose(); a.confirmAdmission(); await flush(); expect(senderA).toHaveBeenCalledOnce();
});

it("503 before persistence plus Stop blocks every further POST, including retry wakeups; stored terminal ends observation without resubmission", async () => {
  const controller = new AbortController();
  const response = deferred<Response>(); const states: unknown[] = [];
  const stop = new PendingTurnStop({ sendControl: async () => false, onPause: vi.fn(), onBusy: vi.fn() });
  const request = vi.fn(() => response.promise); let wake!: () => void;
  const run = consumeRecoverableChatStream({ request, signal: controller.signal, pendingStop: stop, scheduler,
    onEvent: vi.fn(), onMeasurement: vi.fn(), onRecoveryState: state => states.push(state),
    waitForRetry: signal => new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error("observer aborted"));
      signal.addEventListener("abort", abort, { once: true });
      wake = () => { signal.removeEventListener("abort", abort); resolve(); };
    }) });
  await stop.requestStop(); response.resolve(Response.json({ error: "synthetic persistence failure" }, { status: 503 }));
  // Response JSON consumption uses native streams; wait for the actual pause.
  for (let index = 0; index < 50 && !wake; index++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(states).toContainEqual({ state: "paused", admissionUnconfirmed: true });
  expect(request).toHaveBeenCalledOnce(); wake(); await flush();
  expect(request).toHaveBeenCalledOnce(); expect(stop.terminalObserved).toBe(false);
  stop.observeTerminal(); wake(); await run;
  expect(request).toHaveBeenCalledOnce(); expect(states.at(-1)).toEqual({ state: "idle" });
});

it("a 200 admission arriving after Stop keeps server events authoritative and uses the same pending intent", async () => {
  const response = deferred<Response>(), sender = vi.fn(async () => false), events: unknown[] = [];
  const stop = new PendingTurnStop({ sendControl: sender, onPause: vi.fn(), onBusy: vi.fn() });
  const run = consumeRecoverableChatStream({ request: () => response.promise, signal: new AbortController().signal,
    pendingStop: stop, scheduler, onAccepted: () => stop.confirmAdmission(), onEvent: event => events.push(event),
    onMeasurement: vi.fn(), onRecoveryState: vi.fn() });
  await stop.requestStop();
  response.resolve(new Response(`${JSON.stringify({ type: "done" })}\n`));
  await run; await flush();
  expect(sender).toHaveBeenCalledTimes(2); expect(events).toEqual([{ type: "done" }]);
  expect(events).not.toContainEqual({ type: "stopped" });
});


it.each([null, { ok: true }, { ok: false, action: "stop", idempotent: false },
  { ok: true, action: "steer", idempotent: false }, { ok: true, action: "stop", idempotent: "true" }])(
  "HTTP success without a valid Stop receipt is still an unconfirmed control %#", payload => {
    expect(stopControlAccepted(payload)).toBe(false);
  },
);
it("validates an accepted/idempotent control receipt without treating it as terminal Stop", () => {
  expect(stopControlAccepted({ ok: true, action: "stop", idempotent: true })).toBe(true);
  expect(stopControlAccepted({ ok: true, action: "stop", idempotent: false })).toBe(true);
});
