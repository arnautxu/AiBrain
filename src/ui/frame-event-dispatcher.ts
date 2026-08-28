import type { ChatStreamEvent } from "@/lib/chat-contract";

type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

const browserScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export function createChatEventFrameDispatcher(
  onEvent: (event: ChatStreamEvent) => void,
  scheduler: FrameScheduler = browserScheduler,
) {
  let pendingDelta = "";
  let frame: number | null = null;
  let closed = false;

  const flush = () => {
    frame = null;
    if (!pendingDelta || closed) return;
    const value = pendingDelta;
    pendingDelta = "";
    onEvent({ type: "delta", value });
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
    },
    close() {
      if (closed) return;
      if (frame !== null) scheduler.cancel(frame);
      flush();
      closed = true;
    },
  };
}
