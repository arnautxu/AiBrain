import { describe, expect, it, vi } from "vitest";
import { createChatEventFrameDispatcher } from "@/ui/frame-event-dispatcher";

describe("chat event frame dispatcher", () => {
  it("coalesces adjacent deltas per frame and preserves non-delta ordering", () => {
    let scheduled: (() => void) | null = null;
    const events = vi.fn();
    const scheduler = {
      request: vi.fn((callback: () => void) => { scheduled = callback; return 1; }),
      cancel: vi.fn(),
    };
    const dispatcher = createChatEventFrameDispatcher(events, scheduler);

    dispatcher.dispatch({ type: "delta", value: "Hola" });
    dispatcher.dispatch({ type: "delta", value: " mundo" });
    expect(events).not.toHaveBeenCalled();
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    (scheduled as (() => void) | null)?.();
    expect(events).toHaveBeenLastCalledWith({ type: "delta", value: "Hola mundo" });

    dispatcher.dispatch({ type: "delta", value: "." });
    dispatcher.dispatch({ type: "activity", item: { id: "activity-1", kind: "system", label: "Listo", status: "complete" } });
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(["delta", "delta", "activity"]);
    expect(events.mock.calls[1]?.[0]).toEqual({ type: "delta", value: "." });
    dispatcher.close();
    dispatcher.dispatch({ type: "done" });
    expect(events).toHaveBeenCalledTimes(3);
  });
});
