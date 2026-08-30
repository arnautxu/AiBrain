import { describe, expect, it, vi } from "vitest";
import { createChatEventFrameDispatcher } from "@/ui/frame-event-dispatcher";

describe("chat event frame dispatcher", () => {
  it("applies the first delta immediately, then coalesces per frame and preserves ordering", () => {
    let scheduledFrame: (() => void) | null = null;
    let scheduledFallback: (() => void) | null = null;
    const events = vi.fn();
    const scheduler = {
      request: vi.fn((callback: () => void) => { scheduledFrame = callback; return 1; }),
      cancel: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => { scheduledFallback = callback; return 2 as unknown as ReturnType<typeof setTimeout>; }),
      clearTimeout: vi.fn(),
    };
    const dispatcher = createChatEventFrameDispatcher(events, scheduler);

    dispatcher.dispatch({ type: "delta", value: "Hola" });
    dispatcher.dispatch({ type: "delta", value: " mundo" });
    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenLastCalledWith({ type: "delta", value: "Hola" });
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    (scheduledFrame as (() => void) | null)?.();
    expect(events).toHaveBeenLastCalledWith({ type: "delta", value: " mundo" });
    expect(scheduler.clearTimeout).toHaveBeenCalled();

    dispatcher.dispatch({ type: "delta", value: "." });
    dispatcher.dispatch({ type: "activity", item: { id: "activity-1", kind: "system", label: "Listo", status: "complete" } });
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(["delta", "delta", "delta", "activity"]);
    expect(events.mock.calls[2]?.[0]).toEqual({ type: "delta", value: "." });
    dispatcher.close();
    dispatcher.dispatch({ type: "done" });
    expect(events).toHaveBeenCalledTimes(4);
    expect(scheduledFallback).not.toBeNull();
  });

  it("flushes through the bounded fallback when animation frames are throttled", () => {
    let fallback: (() => void) | null = null;
    const events = vi.fn();
    const dispatcher = createChatEventFrameDispatcher(events, {
      request: vi.fn(() => 1),
      cancel: vi.fn(),
      setTimeout: vi.fn((callback) => { fallback = callback; return 2 as unknown as ReturnType<typeof setTimeout>; }),
      clearTimeout: vi.fn(),
    });
    dispatcher.dispatch({ type: "delta", value: "A" });
    for (let index = 0; index < 10_000; index += 1) dispatcher.dispatch({ type: "delta", value: "x" });
    expect(events).toHaveBeenCalledOnce();
    (fallback as (() => void) | null)?.();
    expect(events).toHaveBeenCalledTimes(2);
    expect(events.mock.calls[1]?.[0]).toEqual({ type: "delta", value: "x".repeat(10_000) });
  });
});
