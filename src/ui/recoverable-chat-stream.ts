import { consumeChatEventStream } from "@/ui/app-server-ui-adapter";
import type { ChatStreamEvent } from "@/lib/chat-contract";

const IDLE_OBSERVATION_MS = 3_000;
const MAX_RECOVERY_ATTEMPTS = 4;
const RECOVERY_BASE_DELAY_MS = 250;
const RECOVERY_MAX_DELAY_MS = 4_000;

export type ChatStreamCloseReason = "stream-ended" | "read-error" | "http-error" | "aborted";

/**
 * Payload-free client transport evidence. Times are relative to send intent;
 * no thread, user, prompt, token or response content is retained here.
 */
export type ChatStreamRecoveryMeasurement = Readonly<{
  responseOpenedAtMs: number | null;
  responseAcceptedAtMs: number | null;
  lastEventAtMs: number | null;
  idleObservedAtMs: number | null;
  closedAtMs: number | null;
  closeCode: null;
  closeReason: ChatStreamCloseReason | null;
  recoveryStartedAtMs: number | null;
  recoveryAttempts: number;
  snapshotObservedAtMs: number | null;
  bannerShownAtMs: number | null;
}>;

export type ChatStreamRecoveryState =
  | Readonly<{ state: "recovering"; attempt: number }>
  | Readonly<{ state: "stalled"; attempt: number }>
  | Readonly<{ state: "recovered" | "idle" }>;

export class ChatStreamRecoveryError extends Error {
  constructor() {
    super("La conexión de la respuesta no se ha podido recuperar.");
    this.name = "ChatStreamRecoveryError";
  }
}

class ChatStreamHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ChatStreamHttpError";
  }
}

export type ChatStreamRecoveryScheduler = Readonly<{
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  random: () => number;
}>;

const browserScheduler: ChatStreamRecoveryScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs) as unknown as ReturnType<typeof setTimeout>,
  clearTimeout: (handle) => window.clearTimeout(handle as unknown as number),
  random: () => Math.random(),
};

function waitFor(delayMs: number, signal: AbortSignal, scheduler: ChatStreamRecoveryScheduler) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      scheduler.clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("La recuperación se ha cancelado.", "AbortError"));
    };
    const timer = scheduler.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function retryDelay(attempt: number, scheduler: ChatStreamRecoveryScheduler) {
  const exponential = Math.min(RECOVERY_MAX_DELAY_MS, RECOVERY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.8 + scheduler.random() * 0.4;
  return Math.round(exponential * jitter);
}

function retryableResponse(response: Response) {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

async function responseFailure(response: Response) {
  let message = "No se ha podido completar la solicitud.";
  if (response.headers.get("content-type")?.includes("application/json")) {
    const payload: unknown = await response.clone().json().catch(() => null);
    if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
      const candidate = payload.error.trim();
      if (candidate) message = candidate.slice(0, 280);
    }
  }
  return new ChatStreamHttpError(message, retryableResponse(response));
}

function emptyMeasurement(): ChatStreamRecoveryMeasurement {
  return {
    responseOpenedAtMs: null,
    responseAcceptedAtMs: null,
    lastEventAtMs: null,
    idleObservedAtMs: null,
    closedAtMs: null,
    closeCode: null,
    closeReason: null,
    recoveryStartedAtMs: null,
    recoveryAttempts: 0,
    snapshotObservedAtMs: null,
    bannerShownAtMs: null,
  };
}

export async function consumeRecoverableChatStream(options: {
  request: (signal: AbortSignal) => Promise<Response>;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
  onAccepted?: () => void;
  onRecoveryState: (state: ChatStreamRecoveryState) => void;
  onMeasurement: (measurement: ChatStreamRecoveryMeasurement) => void;
  scheduler?: ChatStreamRecoveryScheduler;
  startedAt?: number;
}) {
  const scheduler = options.scheduler ?? browserScheduler;
  const startedAt = options.startedAt ?? scheduler.now();
  let measurement = emptyMeasurement();
  let recoveryAttempt = 0;
  let recovered = false;
  let accepted = false;
  let lastHttpFailure: ChatStreamHttpError | null = null;
  const elapsed = () => Math.max(0, Math.round(scheduler.now() - startedAt));
  const publish = () => options.onMeasurement(measurement);
  const update = (next: Partial<ChatStreamRecoveryMeasurement>) => {
    measurement = { ...measurement, ...next };
    publish();
  };

  while (true) {
    if (options.signal.aborted) {
      update({ closedAtMs: elapsed(), closeReason: "aborted" });
      throw options.signal.reason instanceof Error ? options.signal.reason : new DOMException("La recuperación se ha cancelado.", "AbortError");
    }
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let sawTerminal = false;
    let sawSnapshot = false;
    try {
      const response = await options.request(options.signal);
      const responseOpenedAtMs = elapsed();
      update({ responseOpenedAtMs: measurement.responseOpenedAtMs ?? responseOpenedAtMs });
      if (!response.ok) {
        update({ closedAtMs: elapsed(), closeReason: "http-error" });
        const failure = await responseFailure(response);
        lastHttpFailure = failure;
        if (!failure.retryable) throw failure;
      } else {
        if (!accepted) {
          accepted = true;
          update({ responseAcceptedAtMs: responseOpenedAtMs });
          options.onAccepted?.();
        }
        idleTimer = scheduler.setTimeout(() => {
          update({ idleObservedAtMs: elapsed() });
        }, IDLE_OBSERVATION_MS);
        await consumeChatEventStream(response, (event) => {
          update({ lastEventAtMs: elapsed() });
          if (event.type === "snapshot" && recoveryAttempt > 0) {
            sawSnapshot = true;
            update({ snapshotObservedAtMs: elapsed() });
            if (!recovered) {
              recovered = true;
              options.onRecoveryState({ state: "recovered" });
            }
          }
          if (event.type === "done" || event.type === "stopped" || event.type === "error" ||
              (event.type === "snapshot" && event.message.status !== "streaming")) sawTerminal = true;
          options.onEvent(event);
        }, { signal: options.signal });
        update({ closedAtMs: elapsed(), closeReason: options.signal.aborted ? "aborted" : "stream-ended" });
        if (sawTerminal) {
          options.onRecoveryState({ state: "idle" });
          return measurement;
        }
      }
    } catch (error) {
      if (options.signal.aborted) {
        update({ closedAtMs: elapsed(), closeReason: "aborted" });
        throw error;
      }
      if (error instanceof ChatStreamRecoveryError || error instanceof ChatStreamHttpError) throw error;
      update({ closedAtMs: elapsed(), closeReason: "read-error" });
    } finally {
      if (idleTimer !== null) scheduler.clearTimeout(idleTimer);
    }

    recoveryAttempt += 1;
    if (recoveryAttempt > MAX_RECOVERY_ATTEMPTS) throw lastHttpFailure ?? new ChatStreamRecoveryError();
    update({
      recoveryAttempts: recoveryAttempt,
      recoveryStartedAtMs: measurement.recoveryStartedAtMs ?? elapsed(),
    });
    options.onRecoveryState({ state: "recovering", attempt: recoveryAttempt });
    // The banner denotes an actual failed reattach, never a quiet stream.
    if (recoveryAttempt > 1 && !sawSnapshot) {
      update({ bannerShownAtMs: measurement.bannerShownAtMs ?? elapsed() });
      options.onRecoveryState({ state: "stalled", attempt: recoveryAttempt });
    }
    await waitFor(retryDelay(recoveryAttempt, scheduler), options.signal, scheduler);
  }
}
