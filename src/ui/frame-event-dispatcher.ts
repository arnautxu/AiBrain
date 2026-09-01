import type { ChatStreamEvent } from "@/lib/chat-contract";

type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
};

type FrameDispatcherOptions = {
  onEventApplied?: (event: ChatStreamEvent) => void;
};

const browserScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs) as unknown as ReturnType<typeof setTimeout>,
  clearTimeout: (handle) => window.clearTimeout(handle as unknown as number),
};

/** A backgrounded or congested tab must not hold visible text indefinitely. */
export const CHAT_DELTA_MAX_BATCH_WAIT_MS = 48;
export const CHAT_DELTA_REVEAL_TARGET_FRAMES = 16;
export const CHAT_DELTA_IMMEDIATE_CHARACTERS = 12;

export function createChatEventFrameDispatcher(
  onEvent: (event: ChatStreamEvent) => void,
  scheduler: FrameScheduler = browserScheduler,
  options: FrameDispatcherOptions = {},
) {
  let pendingDelta = "";
  let revealCharactersPerFrame = 0;
  let frame: number | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let firstDeltaApplied = false;
  let closed = false;

  const cancelScheduledFlush = () => {
    if (frame !== null) scheduler.cancel(frame);
    frame = null;
    if (fallback !== null) scheduler.clearTimeout?.(fallback);
    fallback = null;
  };

  const applyDelta = (value: string) => {
    const event: ChatStreamEvent = { type: "delta", value };
    onEvent(event);
    options.onEventApplied?.(event);
  };

  const takeVisibleDelta = () => {
    const characters = Array.from(pendingDelta);
    if (characters.length <= CHAT_DELTA_IMMEDIATE_CHARACTERS) {
      pendingDelta = "";
      revealCharactersPerFrame = 0;
      return characters.join("");
    }
    revealCharactersPerFrame = Math.max(
      revealCharactersPerFrame,
      Math.ceil(characters.length / CHAT_DELTA_REVEAL_TARGET_FRAMES),
    );
    const count = Math.min(characters.length, revealCharactersPerFrame);
    const value = characters.slice(0, count).join("");
    pendingDelta = characters.slice(count).join("");
    if (!pendingDelta) revealCharactersPerFrame = 0;
    return value;
  };

  const flushFrame = () => {
    cancelScheduledFlush();
    if (!pendingDelta || closed) return;
    const value = takeVisibleDelta();
    applyDelta(value);
    if (pendingDelta) scheduleFlush();
  };

  const flushAll = () => {
    cancelScheduledFlush();
    if (!pendingDelta || closed) return;
    const value = pendingDelta;
    pendingDelta = "";
    revealCharactersPerFrame = 0;
    applyDelta(value);
  };

  const scheduleFlush = () => {
    if (frame !== null) return;
    // A 30 fps text cadence is perceptually continuous while leaving every
    // alternate browser frame free for Markdown layout, scroll anchoring and
    // input. Updating at token-rate or 60 fps made long answers monopolize the
    // main thread on slower devices.
    frame = scheduler.request(() => {
      frame = scheduler.request(flushFrame);
    });
    fallback = scheduler.setTimeout?.(flushFrame, CHAT_DELTA_MAX_BATCH_WAIT_MS) ?? null;
  };

  return {
    dispatch(event: ChatStreamEvent) {
      if (closed) return;
      if (event.type === "delta") {
        // Apply the first non-empty delta synchronously. React still commits it
        // on its normal paint boundary, while the user avoids paying an extra
        // animation frame before the response can become visible.
        if (!firstDeltaApplied && !pendingDelta && frame === null && event.value) {
          firstDeltaApplied = true;
          pendingDelta = event.value;
          applyDelta(takeVisibleDelta());
          if (pendingDelta) scheduleFlush();
          return;
        }
        pendingDelta += event.value;
        scheduleFlush();
        return;
      }
      flushAll();
      onEvent(event);
      options.onEventApplied?.(event);
    },
    close() {
      if (closed) return;
      flushAll();
      closed = true;
    },
  };
}
