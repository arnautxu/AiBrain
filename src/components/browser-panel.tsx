"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  ArrowClockwise,
  Browser,
  DownloadSimple,
  Hand,
  PaperPlaneTilt,
  SpinnerGap,
  Stop,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  controlBrowser,
  isRecoverableBrowserViewerError,
  issueBrowserViewerToken,
  readBrowserFrame,
  readBrowserStatus,
  sendBrowserViewerCommand,
  type BrowserControlAction,
  type BrowserUiStatus,
  type BrowserViewerToken,
} from "@/ui/browser-ui-adapter";

const lifecycleCopy: Record<BrowserUiStatus["state"]["lifecycle"], string> = {
  stopped: "Navegador detenido",
  starting: "Iniciando navegador…",
  ready: "Listo para el agente",
  "human-control": "Tienes el control",
  recovering: "Recuperando sesión…",
  degraded: "Navegador degradado",
};

export function BrowserPanel({ threadId, open, onClose }: {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<BrowserUiStatus | null>(null);
  const [viewerToken, setViewerToken] = useState<BrowserViewerToken | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [address, setAddress] = useState("https://example.com/");
  const [busy, setBusy] = useState<BrowserControlAction | "navigate" | "input" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameUrlRef = useRef<string | null>(null);
  const viewerTokenRef = useRef<BrowserViewerToken | null>(null);

  const replaceFrame = useCallback((blob: Blob) => {
    const next = URL.createObjectURL(blob);
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = next;
    setFrameUrl(next);
  }, []);

  useEffect(() => () => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
  }, []);

  useEffect(() => {
    viewerTokenRef.current = viewerToken;
  }, [viewerToken]);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    const next = await readBrowserStatus(signal);
    setStatus(next);
    return next;
  }, []);

  const renewViewerToken = useCallback(async (control: boolean, signal?: AbortSignal) => {
    if (!threadId) throw new Error("Abre una conversación antes de iniciar el navegador.");
    const current = await refreshStatus(signal);
    if (current.state.lifecycle !== "ready" && current.state.lifecycle !== "human-control") {
      throw new Error("El navegador privado se está recuperando.");
    }
    if (control && current.state.lifecycle !== "human-control") {
      throw new Error("Vuelve a tomar el control del navegador para continuar.");
    }
    const next = await issueBrowserViewerToken(threadId, control, signal);
    viewerTokenRef.current = next;
    setViewerToken(next);
    return next;
  }, [refreshStatus, threadId]);

  const withViewerRecovery = useCallback(async <Result,>(
    control: boolean,
    operation: (token: BrowserViewerToken) => Promise<Result>,
  ) => {
    const currentToken = viewerTokenRef.current;
    if (!currentToken) throw new Error("El visor privado se está conectando.");
    try {
      return await operation(currentToken);
    } catch (reason) {
      if (!isRecoverableBrowserViewerError(reason)) throw reason;
      const renewed = await renewViewerToken(control);
      return operation(renewed);
    }
  }, [renewViewerToken]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const initial = window.setTimeout(() => {
      void refreshStatus(controller.signal).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se ha podido leer el navegador.");
      });
    }, 0);
    const interval = window.setInterval(() => {
      void refreshStatus(controller.signal).catch(() => undefined);
    }, 2_000);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!open || !threadId || !status?.state.browserSessionId ||
        (status.state.lifecycle !== "ready" && status.state.lifecycle !== "human-control")) {
      return;
    }
    const controller = new AbortController();
    const refresh = () => {
      void issueBrowserViewerToken(threadId, status.state.lifecycle === "human-control", controller.signal)
        .then((next) => {
          viewerTokenRef.current = next;
          setViewerToken(next);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se ha podido abrir el visor.");
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [open, status?.state.browserSessionId, status?.state.lifecycle, threadId]);

  useEffect(() => {
    if (!open || !threadId || !viewerToken ||
        (status?.state.lifecycle !== "ready" && status?.state.lifecycle !== "human-control")) return;
    const controller = new AbortController();
    const refresh = () => {
      void readBrowserFrame(threadId, viewerToken.token, controller.signal)
        .then(replaceFrame)
        .catch((reason: unknown) => {
          if (controller.signal.aborted || !isRecoverableBrowserViewerError(reason)) return;
          void renewViewerToken(status?.state.lifecycle === "human-control", controller.signal)
            .then((renewed) => readBrowserFrame(threadId, renewed.token, controller.signal))
            .then(replaceFrame)
            .then(() => setError(null))
            .catch(() => undefined);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 1_200);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [open, renewViewerToken, replaceFrame, status?.state.lifecycle, threadId, viewerToken]);

  useEffect(() => {
    if (!open || status?.state.lifecycle !== "human-control") return;
    const interval = window.setInterval(() => {
      void controlBrowser("heartbeat").then(setStatus).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [open, status?.state.lifecycle]);

  const runControl = async (action: BrowserControlAction) => {
    setBusy(action);
    setError(null);
    try {
      const next = await controlBrowser(action);
      setStatus(next);
      if (action === "stop" || action === "release") {
        viewerTokenRef.current = null;
        setViewerToken(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido controlar el navegador.");
    } finally {
      setBusy(null);
    }
  };

  const navigate = async () => {
    if (!threadId || !viewerToken || !address.trim()) return;
    setBusy("navigate");
    setError(null);
    try {
      await withViewerRecovery(true, (token) =>
        sendBrowserViewerCommand(threadId, token.token, { action: "navigate", url: address.trim() }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido abrir esa dirección.");
    } finally {
      setBusy(null);
    }
  };

  const clickFrame = async (event: MouseEvent<HTMLImageElement>) => {
    if (!threadId || !viewerToken || status?.state.lifecycle !== "human-control") return;
    const image = imageRef.current;
    if (!image) return;
    const bounds = image.getBoundingClientRect();
    const x = Math.round((event.clientX - bounds.left) * image.naturalWidth / bounds.width);
    const y = Math.round((event.clientY - bounds.top) * image.naturalHeight / bounds.height);
    setBusy("input");
    try {
      for (const pointerEvent of ["mousePressed", "mouseReleased"] as const) {
        await withViewerRecovery(true, (token) =>
          sendBrowserViewerCommand(threadId, token.token, {
            action: "input",
            command: { kind: "mouse", event: pointerEvent, x, y, button: "left", clickCount: 1 },
          }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido enviar el clic.");
    } finally {
      setBusy(null);
    }
  };

  const keyFrame = async (event: KeyboardEvent<HTMLImageElement>) => {
    if (!threadId || !viewerToken || status?.state.lifecycle !== "human-control" || event.key.length > 128) return;
    event.preventDefault();
    try {
      await withViewerRecovery(true, (token) =>
        sendBrowserViewerCommand(threadId, token.token, {
          action: "input",
          command: { kind: "key", event: "keyDown", key: event.key, code: event.code },
        }));
      await withViewerRecovery(true, (token) =>
        sendBrowserViewerCommand(threadId, token.token, {
          action: "input",
          command: { kind: "key", event: "keyUp", key: event.key, code: event.code },
        }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido enviar la tecla.");
    }
  };

  const lifecycle = status?.state.lifecycle ?? null;
  const humanControl = lifecycle === "human-control";
  const canView = lifecycle === "ready" || humanControl;

  return (
    <aside className={`fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-transform xl:static xl:w-[520px] xl:shrink-0 xl:shadow-none ${open ? "translate-x-0" : "translate-x-full xl:hidden"}`} aria-label="Navegador">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3.5">
        <Browser size={16} className="text-[var(--text-secondary)]" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">Navegador</h2>
        <span className="text-[12px] font-medium text-[var(--text-muted)]">{lifecycle ? lifecycleCopy[lifecycle] : "Conectando…"}</span>
        <button type="button" aria-label="Cerrar navegador" className="touch-target rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={15} /></button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
        {lifecycle === "stopped" ? <button type="button" className="browser-action" disabled={!threadId || busy !== null} onClick={() => void runControl("start")}><Browser size={13} />Iniciar</button> : null}
        {lifecycle === "ready" ? <button type="button" className="browser-action" disabled={!threadId || busy !== null} onClick={() => void runControl("takeover")}><Hand size={13} />Tomar control</button> : null}
        {humanControl ? <button type="button" className="browser-action" disabled={busy !== null} onClick={() => void runControl("release")}><PaperPlaneTilt size={13} />Devolver al agente</button> : null}
        {lifecycle && lifecycle !== "stopped" ? <button type="button" className="browser-action text-[var(--danger)]" disabled={busy !== null} onClick={() => void runControl("stop")}><Stop size={13} />Detener</button> : null}
        <button type="button" aria-label="Actualizar estado" className="browser-action ml-auto" disabled={busy !== null} onClick={() => void refreshStatus().catch(() => undefined)}><ArrowClockwise size={13} /></button>
      </div>

      {humanControl ? (
        <form className="flex gap-2 border-b border-[var(--border-subtle)] px-3 py-2" onSubmit={(event) => { event.preventDefault(); void navigate(); }}>
          <label className="sr-only" htmlFor="browser-address">Dirección web</label>
          <input id="browser-address" type="url" className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)]" value={address} onChange={(event) => setAddress(event.target.value)} />
          <button type="submit" className="browser-action" disabled={busy !== null}><PaperPlaneTilt size={13} />Abrir</button>
        </form>
      ) : null}

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#e9e9e7] p-3">
        {canView && frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URLs cannot be optimized by next/image.
          <img ref={imageRef} src={frameUrl} alt="Vista actual del navegador privado" tabIndex={humanControl ? 0 : -1} onClick={(event) => void clickFrame(event)} onKeyDown={(event) => void keyFrame(event)} className={`max-h-full max-w-full rounded-md border border-black/15 bg-white object-contain shadow-sm outline-none ${humanControl ? "cursor-crosshair focus:ring-2 focus:ring-[var(--brain-accent)]" : ""}`} />
        ) : lifecycle === "starting" || lifecycle === "recovering" || !status ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]" role="status"><SpinnerGap size={16} className="motion-safe:animate-spin" />Preparando el navegador privado…</div>
        ) : (
          <div className="max-w-xs text-center text-[13px] leading-5 text-[var(--text-secondary)]"><Browser size={25} className="mx-auto mb-2" /><p>{threadId ? "Inicia el navegador cuando necesites ver o controlar una tarea web." : "Abre una conversación antes de iniciar el navegador."}</p></div>
        )}
        {busy === "input" ? <span className="absolute bottom-5 right-5 rounded-full bg-black/75 px-2.5 py-1 text-[12px] text-white">Enviando interacción…</span> : null}
      </div>

      {error ? <div className="flex items-start gap-2 border-t border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]" role="alert"><WarningCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span></div> : null}
      {status?.runtime?.detail ? <div className="border-t border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-muted)]">{status.runtime.detail}</div> : null}
      {status?.state.downloads.length ? <footer className="max-h-28 overflow-y-auto border-t border-[var(--border)] px-3 py-2">
        <p className="mb-1.5 text-[12px] font-semibold text-[var(--text)]">Descargas</p>
        {status.state.downloads.map((download) => <div key={download.id} className="flex items-center gap-2 py-1 text-[12px] text-[var(--text-muted)]"><DownloadSimple size={12} /><span className="min-w-0 flex-1 truncate">{download.fileName}</span><span>{download.status === "complete" ? "Completada" : download.status === "active" ? "En curso" : "Fallida"}</span></div>)}
      </footer> : null}
    </aside>
  );
}
