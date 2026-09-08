"use client";
import { useEffect, useState } from "react";
import { initialRuntimeStatus, isRuntimeStatus, type RuntimeStatus } from "@/lib/runtime-status";

export function useRuntimeStatus({ hydrated, online, projectId, retry }: {
  hydrated: boolean; online: boolean; projectId: string | null; retry: number;
}) {
  const requestKey = JSON.stringify([projectId, online, retry]);
  const [state, setState] = useState({ key: "", status: initialRuntimeStatus });
  const runtimeStatus = state.key === requestKey ? state.status : { ...state.status, codex: "checking" as const, ready: false };
  useEffect(() => {
    if (!hydrated || !online) return;
    const setRuntimeStatus = (update: RuntimeStatus | ((status: RuntimeStatus) => RuntimeStatus)) => {
      setState(previous => ({ key: requestKey, status: typeof update === "function" ? update(previous.status) : update }));
    };
    let controller: AbortController | null = null;
    let disposed = false;
    let retryTimer: number | undefined;
    let timeout: number | undefined;
    const unavailable = () => setRuntimeStatus(current => ({ ...current, codex: "unavailable", ready: false }));
    const probe = (attempt: number) => {
      if (disposed) return;
      const currentController = new AbortController();
      controller = currentController;
      let expired = false;
      const scheduleRetry = () => {
        if (disposed || retryTimer !== undefined || attempt >= 2) return;
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          if (!disposed && navigator.onLine) probe(attempt + 1);
        }, 2_000 * 2 ** attempt);
      };
      const currentTimeout = window.setTimeout(() => {
        if (disposed) return;
        expired = true;
        unavailable();
        currentController.abort();
        scheduleRetry();
      }, 40_000);
      timeout = currentTimeout;
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      void fetch(`/api/runtime/status${query}`, { signal: currentController.signal, cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .then((status: unknown) => {
          if (disposed || expired) return;
          if (isRuntimeStatus(status) && status.codex !== "checking") {
            setRuntimeStatus(status);
            if (status.mode === "codex" && !status.ready) scheduleRetry();
          } else { unavailable(); scheduleRetry(); }
        })
        .catch(() => { if (!disposed && !expired) { unavailable(); scheduleRetry(); } })
        .finally(() => window.clearTimeout(currentTimeout));
    };
    // Background retries leave a clear unavailable state; they never restart
    // an endless checking spinner. A manual retry or online event opens a new window.
    probe(0);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [projectId, hydrated, online, retry, requestKey]);

  return online ? runtimeStatus : { ...runtimeStatus, codex: "unavailable" as const, ready: false };
}
