export const BROWSER_STATE_SCHEMA_VERSION = 1 as const;

export type BrowserLifecycle =
  | "stopped"
  | "starting"
  | "ready"
  | "human-control"
  | "recovering"
  | "degraded";

export type BrowserController = "none" | "agent" | "human";
export type BrowserRecoveryReason =
  | "process_restart"
  | "human_release"
  | "heartbeat_timeout"
  | "runtime_failure";

export type BrowserDownloadStatus = "active" | "complete" | "failed";

export type BrowserDownloadState = {
  id: string;
  fileName: string;
  status: BrowserDownloadStatus;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BrowserPersistentState = {
  schemaVersion: typeof BROWSER_STATE_SCHEMA_VERSION;
  installationId: string;
  userId: string;
  browserSessionId: string | null;
  lifecycle: BrowserLifecycle;
  controller: BrowserController;
  generation: number;
  heartbeatAt: string | null;
  heartbeatExpiresAt: string | null;
  recoveryAttempt: number;
  lastRecoveryReason: BrowserRecoveryReason | null;
  profileGeneration: number;
  profileCleanShutdown: boolean;
  profileLastOpenedAt: string | null;
  downloads: BrowserDownloadState[];
  createdAt: string;
  updatedAt: string;
};

export type BrowserRoots = Readonly<{
  browserRoot: string;
  profile: string;
  downloads: string;
  stateFile: string;
}>;

export type BrowserRuntimeContext = Readonly<{
  installationId: string;
  userId: string;
  browserSessionId: string;
  generation: number;
  recovering: boolean;
  roots: BrowserRoots;
  downloadProjection?: Readonly<{
    start(fileName: string): Promise<Readonly<{ id: string }>>;
    finish(
      downloadId: string,
      result: { status: "complete"; sizeBytes: number } | { status: "failed" },
    ): Promise<void>;
  }>;
}>;

export type BrowserRuntimeHealth = {
  healthy: boolean;
  detail?: string;
};

export interface ManagedBrowserRuntime {
  start(): Promise<void>;
  health(): Promise<BrowserRuntimeHealth>;
  takeOver(): Promise<void>;
  releaseTakeover(): Promise<void>;
  stop(): Promise<void>;
}

export type BrowserFrame = Readonly<{
  schemaVersion: 1;
  mediaType: "image/png";
  dataBase64: string;
  capturedAt: string;
}>;

export type BrowserInputCommand =
  | Readonly<{
    kind: "mouse";
    event: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
    x: number;
    y: number;
    button?: "none" | "left" | "middle" | "right";
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
  }>
  | Readonly<{
    kind: "key";
    event: "keyDown" | "keyUp" | "char";
    key: string;
    code?: string;
    text?: string;
    modifiers?: number;
  }>;

export type BrowserPageSnapshot = Readonly<{
  schemaVersion: 1;
  url: string;
  title: string;
  text: string;
}>;

export type BrowserTabSnapshot = Readonly<{
  id: string;
  url: string;
  title: string;
  active: true;
}>;

export type BrowserDownloadSnapshot = Readonly<{
  fileName: string;
  sizeBytes: number;
}>;

/** Optional interactive surface implemented by the concrete private CDP adapter. */
export interface InteractiveManagedBrowserRuntime extends ManagedBrowserRuntime {
  captureFrame(threadId: string): Promise<BrowserFrame>;
  agentCaptureFrame(threadId: string): Promise<BrowserFrame>;
  navigate(threadId: string, url: string): Promise<void>;
  dispatchInput(threadId: string, command: BrowserInputCommand): Promise<void>;
  readPage(threadId: string): Promise<BrowserPageSnapshot>;
  listTabs(threadId: string): Promise<readonly BrowserTabSnapshot[]>;
  listDownloads(threadId: string): Promise<readonly BrowserDownloadSnapshot[]>;
  agentNavigate(threadId: string, url: string): Promise<void>;
  agentScroll(threadId: string, deltaX: number, deltaY: number): Promise<void>;
  agentClick(threadId: string, selector: string): Promise<void>;
  agentType(threadId: string, selector: string, text: string, clear: boolean): Promise<void>;
}

export interface BrowserRuntimeFactory {
  create(context: BrowserRuntimeContext): ManagedBrowserRuntime | Promise<ManagedBrowserRuntime>;
}

export type BrowserRuntimeHandle = Readonly<{
  installationId: string;
  userId: string;
  browserSessionId: string;
  generation: number;
  roots: BrowserRoots;
}>;

export type BrowserGatewayCapability = "view" | "control" | "heartbeat" | "takeover";

export type BrowserGatewayClaims = Readonly<{
  version: 2;
  audience: "aibrain-browser-gateway";
  tokenId: string;
  installationId: string;
  userId: string;
  threadId: string;
  browserSessionId: string;
  authSessionHash: string;
  capabilities: BrowserGatewayCapability[];
  issuedAt: number;
  expiresAt: number;
}>;
