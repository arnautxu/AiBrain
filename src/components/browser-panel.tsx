"use client";
/* eslint-disable @next/next/no-img-element -- authenticated blob URLs cannot be optimized by next/image. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FocusEvent, KeyboardEvent, PointerEvent, WheelEvent } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsIn,
  ArrowsOut,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import {
  controlBrowser,
  issueBrowserViewerToken,
  openBrowserFrameStream,
  readBrowserNavigationState,
  readBrowserStatus,
  sendBrowserViewerCommand,
  type BrowserUiStatus,
  type BrowserViewerHistoryAction,
  type BrowserViewerNavigationState,
  type BrowserViewerToken,
  type BrowserViewerControlBinding,
} from "@/ui/browser-ui-adapter";
import { consumeBrowserFrameStream } from "@/ui/browser-frame-stream";
import { BrowserInputQueue } from "@/ui/browser-input-queue";
import {
  ComputerUse,
  type ComputerStep,
} from "@/components/assistant-ui/elements/computer-use";
import { useModalFocus } from "@/ui/use-modal-focus";

type ViewerMetrics = Readonly<{ fps: number; latencyMs: number; captureMs: number }>;
type ViewerPointer = Readonly<{
  displayX: number;
  displayY: number;
  relativeX: number;
  relativeY: number;
  remoteX: number;
  remoteY: number;
  pressed: boolean;
}>;
type HeldViewerPointer = {
  pointerId: number;
  start: ViewerPointer;
  last: ViewerPointer;
};

function normalizedAddress(value: string) {
  const trimmed = value.trim();
  if (trimmed === "about:blank" || /^https?:\/\//iu.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointerPosition(
  image: HTMLImageElement,
  clientX: number,
  clientY: number,
  pressed: boolean,
): ViewerPointer | null {
  const bounds = image.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  const displayX = clamp(clientX - bounds.left, 0, bounds.width);
  const displayY = clamp(clientY - bounds.top, 0, bounds.height);
  const relativeX = displayX / bounds.width;
  const relativeY = displayY / bounds.height;
  return {
    displayX,
    displayY,
    relativeX,
    relativeY,
    remoteX: Math.round(relativeX * image.naturalWidth),
    remoteY: Math.round(relativeY * image.naturalHeight),
    pressed,
  };
}

function mouseInput(
  event: "mouseMoved" | "mousePressed" | "mouseReleased",
  point: ViewerPointer,
  button: "none" | "left",
) {
  return {
    action: "input",
    command: {
      kind: "mouse",
      event,
      x: point.remoteX,
      y: point.remoteY,
      button,
      buttons: event === "mouseReleased" ? 0 : button === "left" ? 1 : 0,
      ...(event === "mousePressed" || event === "mouseReleased" ? { clickCount: 1 } : {}),
    },
  };
}

function wait(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(finish, milliseconds);
    function finish() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

type BrowserPanelProps = {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
  initialStatus?: BrowserUiStatus | null;
};

export function BrowserPanel(props: BrowserPanelProps) {
  // Never reuse a frame, token or pending input across viewer attachments.
  return <BrowserPanelAttachment key={`${props.threadId}:${props.open}`} {...props} />;
}

function BrowserPanelAttachment({ threadId, open, onClose, initialStatus = null }: BrowserPanelProps) {
  const [status, setStatus] = useState<BrowserUiStatus | null>(initialStatus);
  const [viewerToken, setViewerToken] = useState<BrowserViewerToken | null>(null);
  const [navigation, setNavigation] = useState<BrowserViewerNavigationState>({
    url: "about:blank", canGoBack: false, canGoForward: false,
  });
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("about:blank");
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [compactOverlay, setCompactOverlay] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [metrics, setMetrics] = useState<ViewerMetrics | null>(null);
  const [pointer, setPointer] = useState<ViewerPointer | null>(null);
  const [pointerTrail, setPointerTrail] = useState<ComputerStep[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameUrlRef = useRef<string | null>(null);
  const viewerTokenRef = useRef<BrowserViewerToken | null>(null);
  const viewerTokenControlsRef = useRef(false);
  const takeoverPromiseRef = useRef<Promise<BrowserViewerToken> | null>(null);
  const humanControlRef = useRef(false);
  const addressEditingRef = useRef(false);
  const viewportOwnsKeyboardRef = useRef(false);
  const lastPointerSentAtRef = useRef(0);
  const pendingWheelRef = useRef<{ command: { kind: string; event: string; x: number; y: number; button: string; deltaX: number; deltaY: number } } | null>(null);
  const heldPointerRef = useRef<HeldViewerPointer | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const lastMetricsAtRef = useRef(0);
  const pendingPaintRef = useRef<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const inputQueueRef = useRef(new BrowserInputQueue());
  const attachmentRef = useRef(true);
  const tokenIssuedAtRef = useRef(0);
  const [attachmentId] = useState(() => crypto.randomUUID());
  const controlBindingRef = useRef<BrowserViewerControlBinding | null>(null);

  const releaseControl = useCallback(async () => {
    const binding = controlBindingRef.current;
    controlBindingRef.current = null;
    humanControlRef.current = false;
    viewerTokenControlsRef.current = false;
    heldPointerRef.current = null;
    if (binding) return controlBrowser("release", undefined, binding).catch(() => null);
    return null;
  }, []);

  const replaceFrame = useCallback((blob: Blob) => {
    const next = URL.createObjectURL(blob);
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = next;
    setFrameUrl(next);
  }, []);

  useEffect(() => {
    attachmentRef.current = true;
    const inputQueue = new BrowserInputQueue();
    inputQueueRef.current = inputQueue;
    return () => {
      attachmentRef.current = false;
      inputQueue.cancel();
      if (pendingPaintRef.current !== null) window.cancelAnimationFrame(pendingPaintRef.current);
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      void releaseControl();
    };
  }, [releaseControl]);

  useEffect(() => { viewerTokenRef.current = viewerToken; }, [viewerToken]);
  useEffect(() => { humanControlRef.current = status?.state.lifecycle === "human-control"; }, [status?.state.lifecycle]);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    const next = await readBrowserStatus(signal);
    setStatus(next);
    return next;
  }, []);

  const renewViewerToken = useCallback(async (control: boolean, signal?: AbortSignal) => {
    if (!threadId) throw new Error("Abre una conversación antes de iniciar el navegador.");
    const requestedAt = Date.now();
    const next = await issueBrowserViewerToken(threadId, control, signal);
    if (!attachmentRef.current || signal?.aborted) throw new Error("El visor se ha cerrado.");
    viewerTokenRef.current = next;
    tokenIssuedAtRef.current = requestedAt;
    viewerTokenControlsRef.current = control;
    setViewerToken(next);
    return next;
  }, [threadId]);

  const ensureControl = useCallback(async () => {
    if (!threadId) throw new Error("Abre una conversación antes de controlar el navegador.");
    if (!attachmentRef.current) throw new Error("El visor se ha cerrado.");
    if (controlBindingRef.current && humanControlRef.current && viewerTokenRef.current && viewerTokenControlsRef.current &&
      Date.now() - tokenIssuedAtRef.current < 25_000) {
      return viewerTokenRef.current;
    }
    if (takeoverPromiseRef.current) return takeoverPromiseRef.current;
    const takeover = (async () => {
      const current = await refreshStatus();
      if (!attachmentRef.current) throw new Error("El visor se ha cerrado.");
      if (!controlBindingRef.current || controlBindingRef.current.browserSessionId !== current.state.browserSessionId ||
        current.state.lifecycle !== "human-control") {
        if ((current.state.lifecycle !== "ready" && current.state.lifecycle !== "human-control") ||
          !current.state.browserSessionId) throw new Error("La sesión se está reconectando.");
        const binding = { attachmentId, browserSessionId: current.state.browserSessionId };
        const controlled = await controlBrowser("takeover", undefined, binding);
        controlBindingRef.current = binding;
        if (!attachmentRef.current) {
          await releaseControl();
          throw new Error("El visor se ha cerrado.");
        }
        setStatus(controlled);
        humanControlRef.current = true;
      }
      return renewViewerToken(true);
    })();
    takeoverPromiseRef.current = takeover;
    try {
      return await takeover;
    } finally {
      if (takeoverPromiseRef.current === takeover) takeoverPromiseRef.current = null;
    }
  }, [attachmentId, refreshStatus, releaseControl, renewViewerToken, threadId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const poll = () => {
      void refreshStatus(controller.signal).then((next) => {
        if ((next.state.lifecycle === "stopped" || next.state.lifecycle === "degraded") && threadId) {
          return controlBrowser("start", controller.signal).then(setStatus);
        }
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se ha podido conectar el navegador.");
      });
    };
    poll();
    const interval = window.setInterval(poll, 2_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [open, refreshStatus, threadId]);

  useEffect(() => {
    if (!open || !threadId || !status?.state.browserSessionId ||
      (status.state.lifecycle !== "ready" && status.state.lifecycle !== "human-control")) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void renewViewerToken(status.state.lifecycle === "human-control", controller.signal).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se ha podido abrir el visor.");
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, renewViewerToken, status?.state.browserSessionId, status?.state.lifecycle, threadId]);

  useEffect(() => {
    if (!open || !threadId || !viewerToken) return;
    const controller = new AbortController();
    const updateNavigation = () => {
      void readBrowserNavigationState(threadId, viewerToken.token, controller.signal).then((next) => {
        setNavigation(next);
        if (!addressEditingRef.current) setAddress(next.url);
      }).catch(() => undefined);
    };
    updateNavigation();
    const interval = window.setInterval(updateNavigation, 1_500);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [open, threadId, viewerToken]);

  useEffect(() => {
    if (!open || !threadId || !viewerToken) return;
    const controller = new AbortController();
    let reconnectAttempt = 0;

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          setConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
          const response = await openBrowserFrameStream(threadId, viewerToken.token, controller.signal);
          await consumeBrowserFrameStream(response, (record) => {
            if (record.metadata.kind === "heartbeat") return;
            reconnectAttempt = 0;
            setPointerTrail((record.metadata.pointerTrail ?? []).map((point) => ({
              ...point,
              action: "click",
              target: "Interacción en el navegador",
            })));
            const now = performance.now();
            frameTimesRef.current = [...frameTimesRef.current.filter((value) => now - value <= 2_000), now].slice(-30);
            const first = frameTimesRef.current[0] ?? now;
            const fps = frameTimesRef.current.length > 1
              ? (frameTimesRef.current.length - 1) * 1_000 / Math.max(1, now - first) : 0;
            if (now - lastMetricsAtRef.current >= 400) {
              lastMetricsAtRef.current = now;
              setMetrics({
                fps,
                latencyMs: Math.max(0, Date.now() - Date.parse(record.metadata.capturedAt)),
                captureMs: record.metadata.captureDurationMs,
              });
            }
            const blob = new Blob([record.data.slice().buffer], { type: "image/png" });
            if (pendingPaintRef.current !== null) window.cancelAnimationFrame(pendingPaintRef.current);
            pendingPaintRef.current = window.requestAnimationFrame(() => {
              pendingPaintRef.current = null;
              if (!controller.signal.aborted) replaceFrame(blob);
            });
          }, controller.signal);
          if (controller.signal.aborted) return;
          reconnectAttempt += 1;
          setConnection("reconnecting");
          await renewViewerToken(humanControlRef.current, controller.signal);
          return; // The token state starts exactly one replacement effect/stream.
        } catch (reason) {
          if (controller.signal.aborted) return;
          reconnectAttempt += 1;
          setConnection("reconnecting");
          if (reconnectAttempt >= 4) setError(reason instanceof Error ? reason.message : "La pantalla se está reconectando.");
          await wait(Math.min(2_000, 150 * (2 ** Math.min(reconnectAttempt, 4))), controller.signal);
          try {
            await renewViewerToken(humanControlRef.current, controller.signal);
            return; // The token state starts exactly one replacement effect/stream.
          } catch {
            // Retry only the viewer attachment. Browser inputs are never replayed.
          }
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [open, renewViewerToken, replaceFrame, threadId, viewerToken]);

  useEffect(() => {
    if (!open || status?.state.lifecycle !== "human-control") return;
    const interval = window.setInterval(() => {
      const binding = controlBindingRef.current;
      if (binding) void controlBrowser("heartbeat", undefined, binding).then(setStatus).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [open, status?.state.lifecycle]);

  const runViewerCommands = useCallback(async (
    commands: Record<string, unknown>[],
    acquireControl = true,
    coalesceKey?: string,
    beforeDispatch?: () => void,
  ) => {
    if (!threadId || !open || !attachmentRef.current) return null;
    if (commands.some((command) => command.action !== "input" ||
      (command.command as { event?: string })?.event !== "mouseWheel")) pendingWheelRef.current = null;
    setError(null);
    try {
      return await inputQueueRef.current.enqueue(async (assertCurrent) => {
        const token = acquireControl
          ? await ensureControl()
          : controlBindingRef.current && humanControlRef.current && viewerTokenControlsRef.current
            ? viewerTokenRef.current
            : null;
        assertCurrent();
        if (!token) return null;
        if (token.browserSessionId !== status?.state.browserSessionId) {
          throw new Error("La sesión ha cambiado. Revisa la página antes de continuar.");
        }
        beforeDispatch?.();
        let next: BrowserViewerNavigationState | null = null;
        if (commands.length > 1 && commands.every((command) => command.action === "input")) {
          next = await sendBrowserViewerCommand(threadId, token.token, {
            action: "inputs", commands: commands.map((command) => command.command),
          });
        } else {
          for (const command of commands) {
            assertCurrent();
            next = await sendBrowserViewerCommand(threadId, token.token, command);
          }
        }
        assertCurrent();
        if (next) {
          setNavigation(next);
          if (!addressEditingRef.current) setAddress(next.url);
        }
        return next;
      }, coalesceKey);
    } catch (reason) {
      // Renew on the next deliberate input, never retry a possibly dispatched mutation.
      viewerTokenControlsRef.current = false;
      if (attachmentRef.current) setError(reason instanceof Error ? reason.message : "No se ha podido controlar el navegador.");
      return null;
    }
  }, [ensureControl, open, status?.state.browserSessionId, threadId]);

  const navigate = async () => {
    setNavigating(true);
    try { await runViewerCommands([{ action: "navigate", url: normalizedAddress(address) }]); }
    finally { setNavigating(false); }
  };

  const navigateHistory = async (direction: BrowserViewerHistoryAction) => {
    setNavigating(true);
    try { await runViewerCommands([{ action: "history", direction }]); }
    finally { setNavigating(false); }
  };

  const releaseHeldPointer = useCallback((options: {
    pointerId?: number;
    point?: ViewerPointer | null;
    cancelled?: boolean;
    updateUi?: boolean;
  } = {}) => {
    const held = heldPointerRef.current;
    if (!held || (options.pointerId !== undefined && held.pointerId !== options.pointerId)) {
      return Promise.resolve(null);
    }
    const last = options.point ?? held.last;
    const released = { ...last, pressed: false };
    heldPointerRef.current = null;
    if (options.updateUi !== false) setPointer(released);
    if (!options.cancelled) {
      const dragged = Math.hypot(
        released.displayX - held.start.displayX,
        released.displayY - held.start.displayY,
      ) > 3;
      setPointerTrail((current) => [...current, {
        id: `human-${Date.now()}-${held.pointerId}`,
        action: dragged ? "drag" : "click",
        target: dragged ? "Arrastre manual" : "Clic manual",
        x: released.relativeX * 100,
        y: released.relativeY * 100,
      }].slice(-3));
    }
    return runViewerCommands([mouseInput("mouseReleased", released, "left")]);
  }, [runViewerCommands]);

  const pressFrame = (event: PointerEvent<HTMLImageElement>) => {
    if (!event.isPrimary || event.button !== 0 || heldPointerRef.current) return;
    const point = pointerPosition(event.currentTarget, event.clientX, event.clientY, true);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    // The remote page is a streamed image, not an embedded document. Native
    // automation and some pointer paths can leave document.activeElement on
    // the URL input even though this pointer event reached the viewport. Keep
    // explicit keyboard ownership so subsequent keys follow the last surface
    // the person deliberately interacted with.
    viewportOwnsKeyboardRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    heldPointerRef.current = { pointerId: event.pointerId, start: point, last: point };
    lastPointerSentAtRef.current = 0;
    setError(null);
    setPointer(point);
    void runViewerCommands([mouseInput("mousePressed", point, "left")]);
  };

  const moveFrame = (event: PointerEvent<HTMLImageElement>) => {
    if (!event.isPrimary) return;
    const held = heldPointerRef.current;
    if (held && held.pointerId !== event.pointerId) return;
    const point = pointerPosition(event.currentTarget, event.clientX, event.clientY, Boolean(held));
    if (!point) return;
    setPointer(point);
    if (held) held.last = point;

    const now = performance.now();
    if (now - lastPointerSentAtRef.current < 80) return;
    lastPointerSentAtRef.current = now;
    void runViewerCommands([mouseInput("mouseMoved", point, held ? "left" : "none")], Boolean(held), `move:${held ? "held" : "hover"}`);
  };

  const releaseFrame = (event: PointerEvent<HTMLImageElement>) => {
    const held = heldPointerRef.current;
    if (!held || held.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointerPosition(event.currentTarget, event.clientX, event.clientY, false);
    void releaseHeldPointer({ pointerId: event.pointerId, point });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelFrame = (event: PointerEvent<HTMLImageElement>) => {
    const held = heldPointerRef.current;
    if (!held || held.pointerId !== event.pointerId) return;
    void releaseHeldPointer({ pointerId: event.pointerId, cancelled: true });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const loseFrameCapture = (event: PointerEvent<HTMLImageElement>) => {
    void releaseHeldPointer({ pointerId: event.pointerId, cancelled: true });
  };

  const scrollFrame = (event: WheelEvent<HTMLImageElement>) => {
    event.preventDefault();
    const image = imageRef.current;
    if (!image || !threadId) return;
    const point = pointerPosition(image, event.clientX, event.clientY, false);
    if (!point) return;
    // Browsers report wheel deltas in pixels, lines or pages. Preserve total
    // movement while one HTTP request is pending instead of replaying a backlog.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? image.naturalHeight : 1;
    const x = clamp(event.deltaX * scale, -100_000, 100_000);
    const y = clamp(event.deltaY * scale, -100_000, 100_000);
    const pending = pendingWheelRef.current;
    if (pending) {
      pending.command.x = point.remoteX;
      pending.command.y = point.remoteY;
      pending.command.deltaX = clamp(pending.command.deltaX + x, -100_000, 100_000);
      pending.command.deltaY = clamp(pending.command.deltaY + y, -100_000, 100_000);
      return;
    }
    const next = { command: {
      kind: "mouse", event: "mouseWheel", x: point.remoteX, y: point.remoteY,
      button: "none", deltaX: x, deltaY: y,
    } };
    pendingWheelRef.current = next;
    void runViewerCommands([{ action: "input", command: next.command }], true, "wheel", () => {
      if (pendingWheelRef.current === next) pendingWheelRef.current = null;
    }).finally(() => {
      if (pendingWheelRef.current === next) pendingWheelRef.current = null;
    });
  };

  const keyFrame = async (event: KeyboardEvent<HTMLElement>) => {
    if (!threadId || event.key.length > 128) return;
    // Let the local browser deliver clipboard text through onPaste.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) |
      (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    await runViewerCommands(["keyDown", "keyUp"].map((keyEvent) => ({
      action: "input",
      command: {
        kind: "key", event: keyEvent, key: event.key, code: event.code, modifiers,
        ...(keyEvent === "keyDown" && event.key.length === 1 &&
          !event.ctrlKey && !event.metaKey && !event.altKey ? { text: event.key } : {}),
      },
    })));
  };

  const pasteFrame = async (event: ClipboardEvent<HTMLElement>) => {
    const text = event.clipboardData.getData("text").slice(0, 4_096);
    if (!text || !threadId) return;
    event.preventDefault();
    await runViewerCommands([{
      action: "input", command: { kind: "key", event: "char", key: "Unidentified", text },
    }]);
  };

  const closePanel = () => {
    // Detach immediately; late takeover completion performs its scoped release.
    attachmentRef.current = false;
    inputQueueRef.current.cancel();
    void releaseControl();
    const returnFocusTarget = returnFocusRef.current;
    setFullscreen(false);
    setPointer(null);
    setPointerTrail([]);
    viewportOwnsKeyboardRef.current = false;
    onClose();
    window.requestAnimationFrame(() => {
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1279px)");
    const sync = () => setCompactOverlay(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const panelRef = useModalFocus<HTMLElement>(
    open && compactOverlay,
    closePanel,
    closeButtonRef,
    returnFocusRef,
  );

  const live = connection === "live";
  const indicator = navigating ? "Cargando página…" : live
    ? metrics ? `${metrics.fps.toFixed(1)} FPS · ${Math.round(metrics.latencyMs)} ms` : "Conectado"
    : connection === "reconnecting" ? "Reconectando" : "Conectando";

  return (
    <aside
      ref={panelRef}
      data-side-window="browser"
      className={`${fullscreen ? "fixed inset-0 z-50" : "fixed inset-y-0 right-0 z-30 xl:static xl:min-w-[640px] xl:w-[56vw] xl:max-w-[1100px]"} flex w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] xl:shadow-none ${open ? "translate-x-0" : "translate-x-full xl:hidden"}`}
      aria-label="Navegador"
      aria-busy={navigating}
      aria-hidden={!open ? "true" : undefined}
      aria-modal={open && compactOverlay ? "true" : undefined}
      role={open && compactOverlay ? "dialog" : undefined}
      tabIndex={open && compactOverlay ? -1 : undefined}
      inert={!open ? true : undefined}
      onKeyDownCapture={(event) => {
        if (event.target === imageRef.current || viewportOwnsKeyboardRef.current) void keyFrame(event);
      }}
      onPasteCapture={(event) => {
        if (event.target === imageRef.current || viewportOwnsKeyboardRef.current) void pasteFrame(event);
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-raised)] px-2"
        onPointerDownCapture={() => { viewportOwnsKeyboardRef.current = false; }}
        onFocusCapture={(event: FocusEvent<HTMLElement>) => {
          if (event.target instanceof HTMLElement) viewportOwnsKeyboardRef.current = false;
        }}>
        <span className="shrink-0 px-1 text-[11px] font-semibold text-[var(--text)]">Navegador</span>
        <button data-browser-capability="back" type="button" aria-label="Atrás" title="Atrás" className="browser-action size-8 justify-center p-0" disabled={!navigation.canGoBack} onClick={() => void navigateHistory("back")}><ArrowLeft size={15} /></button>
        <button data-browser-capability="forward" type="button" aria-label="Adelante" title="Adelante" className="browser-action size-8 justify-center p-0" disabled={!navigation.canGoForward} onClick={() => void navigateHistory("forward")}><ArrowRight size={15} /></button>
        <button data-browser-capability="reload" type="button" aria-label="Recargar" title="Recargar" className="browser-action size-8 justify-center p-0" onClick={() => void navigateHistory("reload")}>{navigating ? <SpinnerGap size={15} className="motion-safe:animate-spin" /> : <ArrowClockwise size={15} />}</button>
        <form data-browser-capability="url" className="mx-1 min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void navigate(); }}>
          <label className="sr-only" htmlFor="browser-address">Dirección web</label>
          <input id="browser-address" type="text" inputMode="url" spellCheck={false}
            className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-center text-[12px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)] focus:text-left"
            value={address} onChange={(event) => setAddress(event.target.value)}
            onFocus={() => { addressEditingRef.current = true; viewportOwnsKeyboardRef.current = false; }}
            onBlur={() => { addressEditingRef.current = false; }} />
        </form>
        <span aria-label={indicator} title={metrics ? `${indicator} · captura ${Math.round(metrics.captureMs)} ms` : indicator}
          className={`mx-1 size-2 shrink-0 rounded-full ${live ? "bg-[var(--positive)]" : connection === "reconnecting" ? "bg-[var(--warning)] motion-safe:animate-pulse" : "bg-[var(--text-subtle)] motion-safe:animate-pulse"}`} role="status" />
        <button data-browser-capability="fullscreen" type="button" aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} className="browser-action size-8 justify-center p-0" onClick={() => setFullscreen((current) => !current)}>{fullscreen ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}</button>
        <button ref={closeButtonRef} type="button" aria-label="Cerrar navegador" title="Cerrar" className="browser-action size-8 justify-center p-0" onClick={closePanel}><X size={15} /></button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#e9e9e7]">
        {frameUrl ? (
          <ComputerUse
            url={navigation.url}
            steps={pointerTrail}
            activeIndex={pointerTrail.length - 1}
            cursor={pointer ? {
              x: pointer.displayX,
              y: pointer.displayY,
              coordinateSpace: "pixel",
              pressed: pointer.pressed,
            } : null}
            showChrome={false}
            showStatus={false}
            className="inline-flex max-h-full w-auto max-w-full rounded-none border-0 bg-transparent dark:bg-transparent"
            viewportClassName="inline-flex min-h-0 max-h-full max-w-full border-0"
          >
            <img data-browser-capability="continuous-scroll" ref={imageRef} src={frameUrl} alt="Vista actual del navegador privado" tabIndex={0}
              draggable={false} onDragStart={(event) => event.preventDefault()}
              onFocus={() => { viewportOwnsKeyboardRef.current = true; }}
              onLoad={() => setConnection("live")}
              onPointerDown={pressFrame} onPointerMove={moveFrame} onPointerUp={releaseFrame}
              onPointerCancel={cancelFrame} onLostPointerCapture={loseFrameCapture}
              onPointerLeave={() => { if (!heldPointerRef.current) setPointer(null); }}
              onWheel={(event) => void scrollFrame(event)}
              className={`${pointer ? "cursor-none" : ""} max-h-full max-w-full touch-none select-none bg-white object-contain outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brain-accent)]`} />
          </ComputerUse>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" role="status"><SpinnerGap size={15} className="motion-safe:animate-spin" />Conectando…</div>
        )}
        {error ? <div className="absolute left-1/2 top-3 max-w-[80%] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-center text-[11px] text-white" role="alert">{error}</div> : null}
      </div>
    </aside>
  );
}
