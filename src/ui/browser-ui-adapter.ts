export type BrowserLifecycle = "stopped" | "starting" | "ready" | "human-control" | "recovering" | "degraded";
export type BrowserController = "none" | "agent" | "human";
export type BrowserDownload = {
  id: string;
  fileName: string;
  status: "active" | "complete" | "failed";
  sizeBytes: number | null;
};
export type BrowserUiStatus = {
  healthy: boolean;
  state: {
    browserSessionId: string | null;
    lifecycle: BrowserLifecycle;
    controller: BrowserController;
    generation: number;
    heartbeatExpiresAt: string | null;
    downloads: BrowserDownload[];
  };
  runtime: { healthy: boolean; detail?: string } | null;
  runningInProcess: boolean;
};

export type BrowserViewerToken = { token: string; browserSessionId: string };
export type BrowserControlAction = "start" | "stop" | "takeover" | "release" | "heartbeat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIFECYCLES = new Set<BrowserLifecycle>(["stopped", "starting", "ready", "human-control", "recovering", "degraded"]);
const CONTROLLERS = new Set<BrowserController>(["none", "agent", "human"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseBrowserStatus(value: unknown): BrowserUiStatus | null {
  const root = record(value);
  const state = record(root?.state);
  const runtime = root?.runtime === null ? null : record(root?.runtime);
  if (!root || !state || typeof root.healthy !== "boolean" || typeof root.runningInProcess !== "boolean" ||
      !(state.browserSessionId === null || (typeof state.browserSessionId === "string" && UUID.test(state.browserSessionId))) ||
      typeof state.lifecycle !== "string" || !LIFECYCLES.has(state.lifecycle as BrowserLifecycle) ||
      typeof state.controller !== "string" || !CONTROLLERS.has(state.controller as BrowserController) ||
      !Number.isSafeInteger(state.generation) || Number(state.generation) < 0 ||
      !(state.heartbeatExpiresAt === null || typeof state.heartbeatExpiresAt === "string") ||
      !Array.isArray(state.downloads) || state.downloads.length > 100 ||
      !(runtime === null || typeof runtime.healthy === "boolean")) return null;
  const downloads: BrowserDownload[] = [];
  for (const item of state.downloads) {
    const download = record(item);
    if (!download || typeof download.id !== "string" || typeof download.fileName !== "string" ||
        download.fileName.length < 1 || download.fileName.length > 180 ||
        (download.status !== "active" && download.status !== "complete" && download.status !== "failed") ||
        !(download.sizeBytes === null || (Number.isSafeInteger(download.sizeBytes) && Number(download.sizeBytes) >= 0))) return null;
    downloads.push({
      id: download.id,
      fileName: download.fileName,
      status: download.status,
      sizeBytes: download.sizeBytes as number | null,
    });
  }
  return {
    healthy: root.healthy,
    state: {
      browserSessionId: state.browserSessionId as string | null,
      lifecycle: state.lifecycle as BrowserLifecycle,
      controller: state.controller as BrowserController,
      generation: Number(state.generation),
      heartbeatExpiresAt: state.heartbeatExpiresAt as string | null,
      downloads,
    },
    runtime: runtime ? {
      healthy: runtime.healthy as boolean,
      ...(typeof runtime.detail === "string" ? { detail: runtime.detail } : {}),
    } : null,
    runningInProcess: root.runningInProcess,
  };
}

async function errorMessage(response: Response) {
  const body = record(await response.json().catch(() => null));
  const message = typeof body?.error === "string" ? body.error : "El navegador privado no está disponible.";
  const retryAfter = response.headers.get("Retry-After");
  return response.status === 429 && retryAfter ? `${message} Reinténtalo en ${retryAfter} s.` : message;
}

export async function readBrowserStatus(signal?: AbortSignal) {
  const response = await fetch("/api/runtime/browser", { cache: "no-store", signal });
  if (!response.ok) throw new Error(await errorMessage(response));
  const status = parseBrowserStatus(await response.json().catch(() => null));
  if (!status) throw new Error("El estado del navegador no cumple el contrato seguro.");
  return status;
}

export async function controlBrowser(action: BrowserControlAction, signal?: AbortSignal) {
  const response = await fetch("/api/runtime/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const status = parseBrowserStatus(await response.json().catch(() => null));
  if (!status) throw new Error("El control del navegador no cumple el contrato seguro.");
  return status;
}

export async function issueBrowserViewerToken(threadId: string, control: boolean, signal?: AbortSignal) {
  const response = await fetch("/api/runtime/browser/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId,
      capabilities: control ? ["view", "control"] : ["view"],
      ttlMs: 30_000,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = record(await response.json().catch(() => null));
  if (!body || typeof body.token !== "string" || body.token.length < 20 ||
      typeof body.browserSessionId !== "string" || !UUID.test(body.browserSessionId)) {
    throw new Error("La autorización del visor no cumple el contrato seguro.");
  }
  return { token: body.token, browserSessionId: body.browserSessionId } satisfies BrowserViewerToken;
}

export async function readBrowserFrame(threadId: string, token: string, signal?: AbortSignal) {
  const response = await fetch(`/api/runtime/browser/viewer/frame?threadId=${encodeURIComponent(threadId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  if (response.headers.get("Content-Type") !== "image/png") {
    throw new Error("El visor ha devuelto un formato inesperado.");
  }
  return response.blob();
}

export async function sendBrowserViewerCommand(
  threadId: string,
  token: string,
  command: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/runtime/browser/viewer/input", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ threadId, ...command }),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}
