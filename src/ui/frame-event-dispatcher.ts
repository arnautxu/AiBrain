import type { ChatStreamEvent } from "@/lib/chat-contract";

type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

type FrameDispatcherOptions = {
  onEventApplied?: (event: ChatStreamEvent) => void;
};

const browserScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export function createChatEventFrameDispatcher(
  onEvent: (event: ChatStreamEvent) => void,
  scheduler: FrameScheduler = browserScheduler,
  options: FrameDispatcherOptions = {},
) {
  let pendingDelta = "";
  let frame: number | null = null;
  let closed = false;

  const flush = () => {
    frame = null;
    if (!pendingDelta || closed) return;
    const value = pendingDelta;
    pendingDelta = "";
    const event: ChatStreamEvent = { type: "delta", value };
    onEvent(event);
    options.onEventApplied?.(event);
  };

  return {
    dispatch(event: ChatStreamEvent) {
      if (closed) return;
      if (event.type === "delta") {
        pendingDelta += event.value;
        frame ??= scheduler.request(flush);
        return;
      }
      if (frame !== null) scheduler.cancel(frame);
      flush();
      onEvent(event);
      options.onEventApplied?.(event);
    },
    close() {
      if (closed) return;
      if (frame !== null) scheduler.cancel(frame);
      flush();
      closed = true;
    },
  };
}
