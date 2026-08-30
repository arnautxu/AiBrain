"use client";
/* eslint-disable @next/next/no-img-element -- authenticated blob URLs cannot be optimized by next/image. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
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
} from "@/ui/browser-ui-adapter";
import { consumeBrowserFrameStream } from "@/ui/browser-frame-stream";

type ViewerMetrics = Readonly<{ fps: number; latencyMs: number; captureMs: number }>;

function normalizedAddress(value: string) {
  const trimmed = value.trim();
  if (trimmed === "about:blank" || /^https?:\/\//iu.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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

export function BrowserPanel({ threadId, open, onClose, initialStatus = null }: {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
  initialStatus?: BrowserUiStatus | null;
}) {
  const [status, setStatus] = useState<BrowserUiStatus | null>(initialStatus);
  const [viewerToken, setViewerToken] = useState<BrowserViewerToken | null>(null);
  const [navigation, setNavigation] = useState<BrowserViewerNavigationState>({
    url: "about:blank", canGoBack: false, canGoForward: false,
  });
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("about:blank");
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [metrics, setMetrics] = useState<ViewerMetrics | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameUrlRef = useRef<string | null>(null);
  const viewerTokenRef = useRef<BrowserViewerToken | null>(null);
  const viewerTokenControlsRef = useRef(false);
  const takeoverPromiseRef = useRef<Promise<BrowserViewerToken> | null>(null);
  const humanControlRef = useRef(false);
  const addressEditingRef = useRef(false);
  const lastPointerSentAtRef = useRef(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastMetricsAtRef = useRef(0);
  const pendingPaintRef = useRef<number | null>(null);

  const replaceFrame = useCallback((blob: Blob) => {
    const next = URL.createObjectURL(blob);
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = next;
    setFrameUrl(next);
  }, []);

  useEffect(() => () => {
    if (pendingPaintRef.current !== null) window.cancelAnimationFrame(pendingPaintRef.current);
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    if (humanControlRef.current) void controlBrowser("release").catch(() => undefined);
  }, []);

  useEffect(() => { viewerTokenRef.current = viewerToken; }, [viewerToken]);
  useEffect(() => { humanControlRef.current = status?.state.lifecycle === "human-control"; }, [status?.state.lifecycle]);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    const next = await readBrowserStatus(signal);
    setStatus(next);
    return next;
  }, []);

  const renewViewerToken = useCallback(async (control: boolean, signal?: AbortSignal) => {
    if (!threadId) throw new Error("Abre una conversación antes de iniciar el navegador.");
    const next = await issueBrowserViewerToken(threadId, control, signal);
    viewerTokenRef.current = next;
    viewerTokenControlsRef.current = control;
    setViewerToken(next);
    return next;
  }, [threadId]);

  const ensureControl = useCallback(async () => {
    if (!threadId) throw new Error("Abre una conversación antes de controlar el navegador.");
    if (humanControlRef.current && viewerTokenRef.current && viewerTokenControlsRef.current) {
      return viewerTokenRef.current;
    }
    if (takeoverPromiseRef.current) return takeoverPromiseRef.current;
    const takeover = (async () => {
      const current = await refreshStatus();
      if (current.state.lifecycle !== "human-control") {
        if (current.state.lifecycle !== "ready") throw new Error("La sesión se está reconectando.");
        const controlled = await controlBrowser("takeover");
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
  }, [refreshStatus, renewViewerToken, threadId]);

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
    let currentToken = viewerToken;
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          setConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
          const response = await openBrowserFrameStream(threadId, currentToken.token, controller.signal);
          await consumeBrowserFrameStream(response, (record) => {
            if (record.metadata.kind === "heartbeat") return;
            reconnectAttempt = 0;
            setConnection("live");
            setError(null);
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
          currentToken = await renewViewerToken(humanControlRef.current, controller.signal);
        } catch (reason) {
          if (controller.signal.aborted) return;
          reconnectAttempt += 1;
          setConnection("reconnecting");
          if (reconnectAttempt >= 4) setError(reason instanceof Error ? reason.message : "La pantalla se está reconectando.");
          await wait(Math.min(2_000, 150 * (2 ** Math.min(reconnectAttempt, 4))), controller.signal);
          try {
            currentToken = await renewViewerToken(humanControlRef.current, controller.signal);
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
      void controlBrowser("heartbeat").then(setStatus).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [open, status?.state.lifecycle]);

  const runViewerCommand = useCallback(async (command: Record<string, unknown>) => {
    if (!threadId) return null;
    setError(null);
    try {
      const token = await ensureControl();
      const next = await sendBrowserViewerCommand(threadId, token.token, command);
      if (next) {
        setNavigation(next);
        if (!addressEditingRef.current) setAddress(next.url);
      }
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido controlar el navegador.");
      return null;
    }
  }, [ensureControl, threadId]);

  const navigate = async () => {
    await runViewerCommand({ action: "navigate", url: normalizedAddress(address) });
  };

  const navigateHistory = async (direction: BrowserViewerHistoryAction) => {
    await runViewerCommand({ action: "history", direction });
  };

  const clickFrame = async (event: MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || !threadId) return;
    const bounds = image.getBoundingClientRect();
    const x = Math.round((event.clientX - bounds.left) * image.naturalWidth / bounds.width);
    const y = Math.round((event.clientY - bounds.top) * image.naturalHeight / bounds.height);
    setPointer({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
    const token = await ensureControl().catch(() => null);
    if (!token) return;
    try {
      for (const pointerEvent of ["mousePressed", "mouseReleased"] as const) {
        await sendBrowserViewerCommand(threadId, token.token, {
          action: "input",
          command: { kind: "mouse", event: pointerEvent, x, y, button: "left", clickCount: 1 },
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido enviar el clic.");
    }
  };

  const moveFrame = (event: PointerEvent<HTMLImageElement>) => {
    if (!threadId || !humanControlRef.current || !viewerTokenRef.current || !viewerTokenControlsRef.current) return;
    const image = imageRef.current;
    if (!image) return;
    const bounds = image.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) / bounds.width;
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    setPointer({ x: relativeX, y: relativeY });
    const now = Date.now();
    if (now - lastPointerSentAtRef.current < 80) return;
    lastPointerSentAtRef.current = now;
    void sendBrowserViewerCommand(threadId, viewerTokenRef.current.token, {
      action: "input",
      command: {
        kind: "mouse", event: "mouseMoved",
        x: Math.round(relativeX * image.naturalWidth),
        y: Math.round(relativeY * image.naturalHeight), button: "none",
      },
    }).catch(() => undefined);
  };

  const scrollFrame = async (event: WheelEvent<HTMLImageElement>) => {
    event.preventDefault();
    const image = imageRef.current;
    if (!image || !threadId) return;
    const bounds = image.getBoundingClientRect();
    const token = await ensureControl().catch(() => null);
    if (!token) return;
    await sendBrowserViewerCommand(threadId, token.token, {
      action: "input",
      command: {
        kind: "mouse", event: "mouseWheel",
        x: Math.round((event.clientX - bounds.left) * image.naturalWidth / bounds.width),
        y: Math.round((event.clientY - bounds.top) * image.naturalHeight / bounds.height),
        button: "none",
        deltaX: Math.max(-100_000, Math.min(100_000, event.deltaX)),
        deltaY: Math.max(-100_000, Math.min(100_000, event.deltaY)),
      },
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "No se ha podido desplazar la página.");
    });
  };

  const keyFrame = async (event: KeyboardEvent<HTMLImageElement>) => {
    if (!threadId || event.key.length > 128) return;
    event.preventDefault();
    const token = await ensureControl().catch(() => null);
    if (!token) return;
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) |
      (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    try {
      for (const keyEvent of ["keyDown", "keyUp"] as const) {
        await sendBrowserViewerCommand(threadId, token.token, {
          action: "input",
          command: {
            kind: "key", event: keyEvent, key: event.key, code: event.code, modifiers,
            ...(keyEvent === "keyDown" && event.key.length === 1 ? { text: event.key } : {}),
          },
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido escribir en la página.");
    }
  };

  const pasteFrame = async (event: ClipboardEvent<HTMLImageElement>) => {
    const text = event.clipboardData.getData("text").slice(0, 4_096);
    if (!text || !threadId) return;
    event.preventDefault();
    const token = await ensureControl().catch(() => null);
    if (!token) return;
    await sendBrowserViewerCommand(threadId, token.token, {
      action: "input", command: { kind: "key", event: "char", key: "Unidentified", text },
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "No se ha podido pegar el texto.");
    });
  };

  const closePanel = async () => {
    humanControlRef.current = false;
    if (status?.state.lifecycle === "human-control") {
      const released = await controlBrowser("release").catch(() => null);
      if (released) setStatus(released);
    }
    setFullscreen(false);
    setPointer(null);
    onClose();
  };

  const live = connection === "live";
  const humanControl = status?.state.lifecycle === "human-control";
  const indicator = live
    ? metrics ? `${metrics.fps.toFixed(1)} FPS · ${Math.round(metrics.latencyMs)} ms` : "Conectado"
    : connection === "reconnecting" ? "Reconectando" : "Conectando";

  return (
    <aside
      className={`${fullscreen ? "fixed inset-0 z-50" : "fixed inset-y-0 right-0 z-30 xl:static xl:min-w-[640px] xl:w-[56vw] xl:max-w-[1100px]"} flex w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] xl:shadow-none ${open ? "translate-x-0" : "translate-x-full xl:hidden"}`}
      aria-label="Navegador"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-raised)] px-2">
        <span className="shrink-0 px-1 text-[11px] font-semibold text-[var(--text)]">Navegador</span>
        <button type="button" aria-label="Atrás" title="Atrás" className="browser-action size-8 justify-center p-0" disabled={!navigation.canGoBack} onClick={() => void navigateHistory("back")}><ArrowLeft size={15} /></button>
        <button type="button" aria-label="Adelante" title="Adelante" className="browser-action size-8 justify-center p-0" disabled={!navigation.canGoForward} onClick={() => void navigateHistory("forward")}><ArrowRight size={15} /></button>
        <button type="button" aria-label="Recargar" title="Recargar" className="browser-action size-8 justify-center p-0" onClick={() => void navigateHistory("reload")}><ArrowClockwise size={15} /></button>
        <form className="mx-1 min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void navigate(); }}>
          <label className="sr-only" htmlFor="browser-address">Dirección web</label>
          <input id="browser-address" type="text" inputMode="url" spellCheck={false}
            className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-center text-[12px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)] focus:text-left"
            value={address} onChange={(event) => setAddress(event.target.value)}
            onFocus={() => { addressEditingRef.current = true; }}
            onBlur={() => { addressEditingRef.current = false; }} />
        </form>
        <span aria-label={indicator} title={metrics ? `${indicator} · captura ${Math.round(metrics.captureMs)} ms` : indicator}
          className={`mx-1 size-2 shrink-0 rounded-full ${live ? "bg-[var(--positive)]" : connection === "reconnecting" ? "bg-[var(--warning)] motion-safe:animate-pulse" : "bg-[var(--text-subtle)] motion-safe:animate-pulse"}`} role="status" />
        <button type="button" aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} className="browser-action size-8 justify-center p-0" onClick={() => setFullscreen((current) => !current)}>{fullscreen ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}</button>
        <button type="button" aria-label="Cerrar navegador" title="Cerrar" className="browser-action size-8 justify-center p-0" onClick={() => void closePanel()}><X size={15} /></button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#e9e9e7]">
        {frameUrl ? (
          <div className="relative inline-flex max-h-full max-w-full">
            <img ref={imageRef} src={frameUrl} alt="Vista actual del navegador privado" tabIndex={0}
              onClick={(event) => void clickFrame(event)} onPointerMove={moveFrame}
              onWheel={(event) => void scrollFrame(event)} onKeyDown={(event) => void keyFrame(event)}
              onPaste={(event) => void pasteFrame(event)}
              className="max-h-full max-w-full bg-white object-contain outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--brain-accent)]" />
            {humanControl && pointer ? <span aria-hidden="true" className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--brain-accent)] shadow" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} /> : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" role="status"><SpinnerGap size={15} className="motion-safe:animate-spin" />Conectando…</div>
        )}
        {error ? <div className="absolute left-1/2 top-3 max-w-[80%] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-center text-[11px] text-white" role="alert">{error}</div> : null}
      </div>
    </aside>
  );
}
