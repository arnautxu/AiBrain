export type BrowserLifecycle = "stopped" | "starting" | "ready" | "human-control" | "recovering" | "degraded";
export type BrowserController = "none" | "agent" | "human";
export type BrowserDownload = {
  id: string;
  fileName: string;
  status: "active" | "complete" | "failed";
  sizeBytes: number | null;
};
export type BrowserUiStatus = {
  available: boolean;
  capabilityCode: string | null;
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

export type BrowserActionHistoryItem = {
  sequence: number;
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  callId: string;
  action: "open" | "read" | "screenshot" | "scroll" | "click" | "type" | "tabs" | "downloads";
  phase: "started" | "dispatched" | "completed" | "denied" | "indeterminate";
  success: boolean | null;
  actor: "agent" | "human";
  occurredAt: string;
};

export type BrowserViewerToken = { token: string; browserSessionId: string };
export type BrowserViewerControlBinding = { attachmentId: string; browserSessionId: string };
export type BrowserControlAction = "start" | "stop" | "takeover" | "release" | "heartbeat";
export type BrowserViewerNavigationState = {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  phase: "idle" | "loading" | "complete" | "error";
  sequence: number;
};
export type BrowserViewerHistoryAction = "back" | "forward" | "reload";

export class BrowserUiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrowserUiRequestError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTALLATION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
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
  if (!root || !state || typeof root.available !== "boolean" ||
      !(root.capabilityCode === null || typeof root.capabilityCode === "string") ||
      typeof root.healthy !== "boolean" || typeof root.runningInProcess !== "boolean" ||
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
    available: root.available,
    capabilityCode: root.capabilityCode as string | null,
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

export function shouldPresentBrowserPanel(status: BrowserUiStatus | null, turnNeedsBrowser: boolean) {
  return Boolean(turnNeedsBrowser && status?.available && status.healthy && status.runningInProcess &&
    (status.state.lifecycle === "ready" || status.state.lifecycle === "human-control"));
}

async function responseError(response: Response) {
  const body = record(await response.json().catch(() => null));
  const message = typeof body?.error === "string" ? body.error : "El navegador privado no está disponible.";
  const retryAfter = response.headers.get("Retry-After");
  return new BrowserUiRequestError(
    response.status === 429 && retryAfter ? `${message} Reinténtalo en ${retryAfter} s.` : message,
    response.status,
    typeof body?.code === "string" ? body.code : null,
    body?.retryable === true,
  );
}

export function isRecoverableBrowserViewerError(error: unknown) {
  return error instanceof BrowserUiRequestError && error.retryable &&
    (error.status === 401 || error.status === 409 || error.status === 503);
}

export async function readBrowserStatus(signal?: AbortSignal) {
  const response = await fetch("/api/runtime/browser", { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  const status = parseBrowserStatus(await response.json().catch(() => null));
  if (!status) throw new Error("El estado del navegador no cumple el contrato seguro.");
  return status;
}

export async function controlBrowser(action: BrowserControlAction, signal?: AbortSignal, binding?: BrowserViewerControlBinding) {
  const response = await fetch("/api/runtime/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(binding ? { binding } : {}) }),
    signal,
  });
  if (!response.ok) throw await responseError(response);
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
  if (!response.ok) throw await responseError(response);
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
  if (!response.ok) throw await responseError(response);
  if (response.headers.get("Content-Type") !== "image/png") {
    throw new Error("El visor ha devuelto un formato inesperado.");
  }
  return response.blob();
}

function parseNavigationState(value: unknown): BrowserViewerNavigationState | null {
  const body = record(value);
  if (!body || typeof body.url !== "string" || body.url.length < 1 || body.url.length > 8_192 ||
    typeof body.canGoBack !== "boolean" || typeof body.canGoForward !== "boolean" ||
    !(body.phase === undefined || body.phase === "idle" || body.phase === "loading" ||
      body.phase === "complete" || body.phase === "error") ||
    !(body.sequence === undefined || (Number.isSafeInteger(body.sequence) && Number(body.sequence) >= 0))) return null;
  try {
    if (body.url !== "about:blank") {
      const parsed = new URL(body.url);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
    }
  } catch {
    return null;
  }
  return {
    url: body.url,
    canGoBack: body.canGoBack,
    canGoForward: body.canGoForward,
    phase: body.phase as BrowserViewerNavigationState["phase"] | undefined ?? "complete",
    sequence: body.sequence === undefined ? 0 : Number(body.sequence),
  };
}

export async function readBrowserNavigationState(
  threadId: string,
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/runtime/browser/viewer/state?threadId=${encodeURIComponent(threadId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal },
  );
  if (!response.ok) throw await responseError(response);
  const navigation = parseNavigationState(await response.json().catch(() => null));
  if (!navigation) throw new Error("La navegación privada no cumple el contrato seguro.");
  return navigation;
}

export async function openBrowserFrameStream(
  threadId: string,
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/runtime/browser/viewer/stream?threadId=${encodeURIComponent(threadId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal },
  );
  if (!response.ok) throw await responseError(response);
  return response;
}

export async function readBrowserActionHistory(
  threadId: string,
  signal?: AbortSignal,
): Promise<BrowserActionHistoryItem[]> {
  const response = await fetch(
    `/api/runtime/browser/history?threadId=${encodeURIComponent(threadId)}&limit=50`,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw await responseError(response);
  const body = record(await response.json().catch(() => null));
  if (!body || !Array.isArray(body.history) || body.history.length > 50) {
    throw new Error("El historial del navegador no cumple el contrato seguro.");
  }
  const result: BrowserActionHistoryItem[] = [];
  for (const value of body.history) {
    const item = record(value);
    if (!item || !Number.isSafeInteger(item.sequence) || Number(item.sequence) < 1 ||
        typeof item.installationId !== "string" || !INSTALLATION_ID.test(item.installationId) ||
        typeof item.userId !== "string" || !UUID.test(item.userId) ||
        typeof item.threadId !== "string" || item.threadId !== threadId || !UUID.test(item.threadId) ||
        typeof item.turnId !== "string" || !OPAQUE_ID.test(item.turnId) ||
        typeof item.callId !== "string" || !OPAQUE_ID.test(item.callId) ||
        !["open", "read", "screenshot", "scroll", "click", "type", "tabs", "downloads"].includes(String(item.action)) ||
        !["started", "dispatched", "completed", "denied", "indeterminate"].includes(String(item.phase)) ||
        !(item.success === null || typeof item.success === "boolean") ||
        (item.actor !== "agent" && item.actor !== "human") ||
        typeof item.occurredAt !== "string" || !Number.isFinite(Date.parse(item.occurredAt))) {
      throw new Error("El historial del navegador no cumple el contrato seguro.");
    }
    result.push(item as BrowserActionHistoryItem);
  }
  return result;
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
  if (!response.ok) throw await responseError(response);
  const body = record(await response.json().catch(() => null));
  if (!body || body.ok !== true) throw new Error("La respuesta del control del navegador no es válida.");
  if (body.navigation === null) return null;
  const navigation = parseNavigationState(body.navigation);
  if (!navigation) throw new Error("La navegación privada no cumple el contrato seguro.");
  return navigation;
}
