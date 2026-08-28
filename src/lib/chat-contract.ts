import type { RuntimeReasoningEffort } from "@/lib/runtime-status";

export type ActivityKind =
  | "system"
  | "reasoning"
  | "plan"
  | "command"
  | "file"
  | "tool"
  | "web"
  | "agent";

export type ActivityStatus =
  | "pending"
  | "running"
  | "waiting"
  | "complete"
  | "failed"
  | "stopped";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  output?: string;
  status: ActivityStatus;
};

export type TurnSourceKind = "web" | "file" | "app";

/** A source observed in runtime metadata. Null fields are deliberately honest. */
export type TurnSource = {
  id: string;
  kind: TurnSourceKind;
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string | null;
  publishedAt: string | null;
};

export type ToolResultKind = "command" | "file" | "web" | "app" | "browser";

export type ToolResult = {
  id: string;
  kind: ToolResultKind;
  title: string;
  status: "running" | "complete" | "failed" | "stopped";
  summary: string | null;
  output: string | null;
  sourceIds: string[];
  createdAt: string;
};

export type PlanStep = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type ApprovalDecision = "accept" | "acceptForSession" | "decline";

export type ComposerMode = "agent" | "plan" | "ask";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export type ChatInputAttachment = ChatAttachment & {
  dataUrl: string;
};

export type ImageArtifact = {
  id: string;
  type: "image";
  name: string;
  url: string;
  prompt: string | null;
};

export type DocumentKind = "docx" | "xlsx" | "pptx" | "pdf" | "text";
export type PublicationStatus = "awaiting_confirmation" | "publishing" | "published" | "declined" | "conflict";

export type DocumentArtifact = {
  id: string;
  type: "document";
  name: string;
  url: string;
  kind: DocumentKind;
  mimeType: string;
  size: number;
  status: "processing" | "ready" | "error";
  pages: number | null;
  previewUrl: string | null;
  publicationStatus: PublicationStatus | null;
  publicationError: string | null;
  targetLabel: string | null;
  error: string | null;
};

export type BrowserArtifact = {
  id: string;
  type: "browser";
  name: string;
  status: "starting" | "ready" | "active" | "reconnecting" | "disconnected" | "closed" | "error";
  control: "agent" | "employee" | "awaiting_approval" | null;
  viewerUrl: string | null;
  captureUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
};

export type GeneratedArtifact = ImageArtifact | DocumentArtifact | BrowserArtifact;

export type TurnOptions = {
  mode: ComposerMode;
  model: string | null;
  effort: RuntimeReasoningEffort | null;
  webSearch: boolean;
  imageGeneration: boolean;
  skill: string | null;
  attachments: ChatInputAttachment[];
  documentUploadIds?: string[];
};

export type ApprovalItem = {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: "command" | "file" | "browser";
  title: string;
  detail: string;
  command?: string;
  cwd?: string;
  permissionFingerprint?: string;
  status: "pending" | "accepted" | "accepted_session" | "declined";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "complete" | "streaming" | "error" | "stopped";
  activity: ActivityItem[];
  plan: PlanStep[];
  approvals: ApprovalItem[];
  diff: string;
  attachments: ChatAttachment[];
  artifacts: GeneratedArtifact[];
  /** Optional while schema-v1 conversations are migrated on read. */
  sources?: TurnSource[];
  /** Optional while schema-v1 conversations are migrated on read. */
  toolResults?: ToolResult[];
};

export type ChatRequest = {
  projectId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  message: string;
  displayMessage?: string;
  preferences: {
    tone: "direct" | "balanced" | "detailed";
    language: "ca" | "es" | "en";
    showActivity: boolean;
  };
  options: TurnOptions;
};

export type ApprovalResolutionRequest = {
  approvalId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  decision: ApprovalDecision;
};

/** The connector approval route accepts only this one explicit action. */
export type ConnectorApprovalResolutionRequest = {
  approvalId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  decision: "accept";
  authorizationFingerprint: string;
};

export type TurnControlRequest =
  | {
      action: "stop";
      threadId: string;
      assistantMessageId: string;
      clientRequestId: string;
    }
  | {
      action: "steer";
      threadId: string;
      assistantMessageId: string;
      clientRequestId: string;
      userMessageId: string;
      message: string;
    };

export type ChatStreamEvent =
  | { type: "snapshot"; message: ChatMessage }
  | { type: "content"; value: string }
  | { type: "activity"; item: ActivityItem }
  | { type: "plan"; explanation: string | null; steps: PlanStep[] }
  | { type: "approval"; item: ApprovalItem }
  | { type: "diff"; value: string }
  | { type: "delta"; value: string }
  | { type: "artifact"; item: GeneratedArtifact }
  | { type: "source"; item: TurnSource }
  | { type: "toolResult"; item: ToolResult }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function hasOptionalString(value: Record<string, unknown>, key: string) {
  return !(key in value) || value[key] === undefined || typeof value[key] === "string";
}

function isOpaqueRuntimeId(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function isUuidString(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSafeNullableText(value: unknown, maximum: number) {
  return value === null || (
    typeof value === "string" && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

export function isTurnSource(value: unknown): value is TurnSource {
  if (!isRecord(value)) return false;
  const url = value.url;
  let validUrl = url === null;
  if (typeof url === "string" && url.length <= 2_048) {
    try {
      const parsed = new URL(url);
      validUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      validUrl = false;
    }
  }
  return typeof value.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value.id) &&
    (value.kind === "web" || value.kind === "file" || value.kind === "app") &&
    typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 240 &&
    !/\p{C}/u.test(value.title) && validUrl &&
    isSafeNullableText(value.domain, 255) &&
    isSafeNullableText(value.snippet, 2_000) &&
    (value.publishedAt === null || isIsoDate(value.publishedAt));
}

export function isToolResult(value: unknown): value is ToolResult {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value.id) &&
    (value.kind === "command" || value.kind === "file" || value.kind === "web" ||
      value.kind === "app" || value.kind === "browser") &&
    typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 240 &&
    !/\p{C}/u.test(value.title) &&
    (value.status === "running" || value.status === "complete" || value.status === "failed" || value.status === "stopped") &&
    isSafeNullableText(value.summary, 4_000) &&
    isSafeNullableText(value.output, 64_000) &&
    Array.isArray(value.sourceIds) && value.sourceIds.length <= 100 &&
    value.sourceIds.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(id)) &&
    new Set(value.sourceIds).size === value.sourceIds.length &&
    isIsoDate(value.createdAt);
}

export function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 120 &&
    typeof value.mimeType === "string" &&
    /^(?:image\/(?:png|jpeg|webp|gif)|application\/(?:pdf|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/(?:plain|markdown|csv)|application\/json)$/.test(value.mimeType) &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size > 0 &&
    value.size <= 50 * 1024 * 1024
  );
}

export function isChatInputAttachment(value: unknown): value is ChatInputAttachment {
  if (!isRecord(value) || !isChatAttachment(value)) return false;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(value.mimeType) || value.size > 2_000_000) return false;
  const dataUrl = (value as Record<string, unknown>).dataUrl;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(`data:${value.mimeType};base64,`) ||
      dataUrl.length > 2_700_000) return false;
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return false;
  }
  if (binary.length !== value.size) return false;
  const byte = (index: number) => binary.charCodeAt(index);
  if (value.mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((expected, index) => byte(index) === expected);
  }
  if (value.mimeType === "image/jpeg") return byte(0) === 0xff && byte(1) === 0xd8 && byte(binary.length - 2) === 0xff && byte(binary.length - 1) === 0xd9;
  if (value.mimeType === "image/gif") return binary.startsWith("GIF87a") || binary.startsWith("GIF89a");
  return binary.startsWith("RIFF") && binary.slice(8, 12) === "WEBP";
}

export function isTurnOptions(value: unknown): value is TurnOptions {
  if (!isRecord(value)) return false;
  const documentUploadIds = value.documentUploadIds;
  const validDocumentUploadIds = documentUploadIds === undefined || (
    Array.isArray(documentUploadIds) && documentUploadIds.length <= 10 &&
    documentUploadIds.every((uploadId) => typeof uploadId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uploadId)) &&
    new Set(documentUploadIds).size === documentUploadIds.length
  );
  return (
    (value.mode === "agent" || value.mode === "plan" || value.mode === "ask") &&
    (value.model === null || (typeof value.model === "string" && value.model.length <= 100)) &&
    (value.effort === null || value.effort === "none" || value.effort === "minimal" ||
      value.effort === "low" || value.effort === "medium" || value.effort === "high" ||
      value.effort === "xhigh" || value.effort === "max" || value.effort === "ultra") &&
    typeof value.webSearch === "boolean" &&
    typeof value.imageGeneration === "boolean" &&
    (value.skill === null || (typeof value.skill === "string" && value.skill.length <= 100)) &&
    Array.isArray(value.attachments) &&
    value.attachments.length <= 3 &&
    value.attachments.every(isChatInputAttachment) &&
    value.attachments.reduce((total, attachment) => total + attachment.size, 0) <= 5_000_000 &&
    validDocumentUploadIds
  );
}

export function isGeneratedArtifact(value: unknown): value is GeneratedArtifact {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.id) ||
    typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) return false;
  if (value.type === "image") {
    return typeof value.url === "string" && value.url.startsWith("/api/projects/") &&
      (value.prompt === null || typeof value.prompt === "string");
  }
  if (value.type === "document") {
    return typeof value.url === "string" && value.url.startsWith("/api/projects/") &&
      (value.kind === "docx" || value.kind === "xlsx" || value.kind === "pptx" || value.kind === "pdf" || value.kind === "text") &&
      typeof value.mimeType === "string" && value.mimeType.length <= 180 &&
      typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 50 * 1024 * 1024 &&
      (value.status === "processing" || value.status === "ready" || value.status === "error") &&
      (value.pages === null || (typeof value.pages === "number" && Number.isSafeInteger(value.pages) && value.pages >= 1 && value.pages <= 500)) &&
      (value.previewUrl === null || (typeof value.previewUrl === "string" && value.previewUrl.startsWith("/api/projects/"))) &&
      (value.publicationStatus === null || value.publicationStatus === "awaiting_confirmation" || value.publicationStatus === "publishing" || value.publicationStatus === "published" || value.publicationStatus === "declined" || value.publicationStatus === "conflict") &&
      (value.publicationError === null || (typeof value.publicationError === "string" && value.publicationError.length <= 500)) &&
      (value.targetLabel === null || (typeof value.targetLabel === "string" && value.targetLabel.length <= 160)) &&
      (value.error === null || (typeof value.error === "string" && value.error.length <= 500));
  }
  if (value.type === "browser") {
    return (value.status === "starting" || value.status === "ready" || value.status === "active" || value.status === "reconnecting" || value.status === "disconnected" || value.status === "closed" || value.status === "error") &&
      (value.control === null || value.control === "agent" || value.control === "employee" || value.control === "awaiting_approval") &&
      (value.viewerUrl === null || (typeof value.viewerUrl === "string" && value.viewerUrl.startsWith("/api/browser/sessions/"))) &&
      (value.captureUrl === null || (typeof value.captureUrl === "string" && value.captureUrl.startsWith("/api/browser/sessions/"))) &&
      (value.downloadUrl === null || (typeof value.downloadUrl === "string" && value.downloadUrl.startsWith("/api/browser/sessions/"))) &&
      (value.error === null || (typeof value.error === "string" && value.error.length <= 500));
  }
  return false;
}

export function isActivityItem(value: unknown): value is ActivityItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.kind === "system" ||
      value.kind === "reasoning" ||
      value.kind === "plan" ||
      value.kind === "command" ||
      value.kind === "file" ||
      value.kind === "tool" ||
      value.kind === "web" ||
      value.kind === "agent") &&
    typeof value.label === "string" &&
    hasOptionalString(value, "detail") &&
    hasOptionalString(value, "output") &&
    (value.status === "pending" ||
      value.status === "running" ||
      value.status === "waiting" ||
      value.status === "complete" ||
      value.status === "failed" ||
      value.status === "stopped")
  );
}

export function isPlanStep(value: unknown): value is PlanStep {
  if (!isRecord(value)) return false;
  return (
    typeof value.step === "string" &&
    (value.status === "pending" ||
      value.status === "in_progress" ||
      value.status === "completed")
  );
}

export function isApprovalItem(value: unknown): value is ApprovalItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isOpaqueRuntimeId(value.id) &&
    isOpaqueRuntimeId(value.threadId) &&
    isOpaqueRuntimeId(value.turnId) &&
    isOpaqueRuntimeId(value.itemId) &&
    (value.kind === "command" || value.kind === "file" || value.kind === "browser") &&
    typeof value.title === "string" &&
    typeof value.detail === "string" &&
    hasOptionalString(value, "command") &&
    hasOptionalString(value, "cwd") &&
    (!("permissionFingerprint" in value) || value.permissionFingerprint === undefined ||
      (typeof value.permissionFingerprint === "string" && /^[0-9a-f]{64}$/u.test(value.permissionFingerprint))) &&
    (value.status === "pending" ||
      value.status === "accepted" ||
      value.status === "accepted_session" ||
      value.status === "declined")
  );
}

export function isApprovalResolutionRequest(
  value: unknown,
): value is ApprovalResolutionRequest {
  if (!isRecord(value)) return false;
  return (
    isOpaqueRuntimeId(value.approvalId) &&
    isOpaqueRuntimeId(value.threadId) &&
    isOpaqueRuntimeId(value.turnId) &&
    isOpaqueRuntimeId(value.itemId) &&
    (value.decision === "accept" ||
      value.decision === "acceptForSession" ||
      value.decision === "decline")
  );
}

export function isConnectorApprovalResolutionRequest(
  value: unknown,
): value is ConnectorApprovalResolutionRequest {
  if (!isRecord(value) || Object.keys(value).length !== 6) return false;
  return (
    isOpaqueRuntimeId(value.approvalId) &&
    isOpaqueRuntimeId(value.threadId) &&
    isOpaqueRuntimeId(value.turnId) &&
    isOpaqueRuntimeId(value.itemId) &&
    value.decision === "accept" &&
    typeof value.authorizationFingerprint === "string" &&
    /^[0-9a-f]{64}$/u.test(value.authorizationFingerprint)
  );
}

export function isTurnControlRequest(value: unknown): value is TurnControlRequest {
  if (!isRecord(value)) return false;
  const common =
    isUuidString(value.threadId) &&
    isUuidString(value.assistantMessageId) &&
    isUuidString(value.clientRequestId);
  if (!common) return false;
  if (value.action === "stop") {
    return Object.keys(value).length === 4;
  }
  if (value.action === "steer") {
    return Object.keys(value).length === 6 &&
      isUuidString(value.userMessageId) &&
      typeof value.message === "string" &&
      value.message.trim().length > 0 &&
      value.message.length <= 32_000 &&
      !value.message.includes("\0");
  }
  return false;
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "done" || value.type === "stopped") return true;
  if (value.type === "snapshot") return isChatMessage(value.message);
  if (value.type === "delta" || value.type === "diff" || value.type === "content") {
    return typeof value.value === "string";
  }
  if (value.type === "error") return typeof value.message === "string";
  if (value.type === "artifact") return isGeneratedArtifact(value.item);
  if (value.type === "source") return isTurnSource(value.item);
  if (value.type === "toolResult") return isToolResult(value.item);
  if (value.type === "activity") return isActivityItem(value.item);
  if (value.type === "approval") return isApprovalItem(value.item);
  if (value.type === "plan") {
    return (
      (value.explanation === null || typeof value.explanation === "string") &&
      Array.isArray(value.steps) &&
      value.steps.every(isPlanStep)
    );
  }

  return false;
}

export function isChatMessage(message: unknown): message is ChatMessage {
  if (!isRecord(message)) return false;
  if (typeof message.id !== "string") return false;
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (typeof message.content !== "string") return false;
  if (typeof message.createdAt !== "string") return false;
  if (
    message.status !== "complete" &&
    message.status !== "streaming" &&
    message.status !== "error" &&
    message.status !== "stopped"
  ) {
    return false;
  }
  if (!Array.isArray(message.activity) || !message.activity.every(isActivityItem)) return false;
  if (!Array.isArray(message.plan) || !message.plan.every(isPlanStep)) return false;
  if (!Array.isArray(message.approvals) || !message.approvals.every(isApprovalItem)) return false;
  if (!Array.isArray(message.attachments) || !message.attachments.every(isChatAttachment)) return false;
  if (!Array.isArray(message.artifacts) || !message.artifacts.every(isGeneratedArtifact)) return false;
  if (message.sources !== undefined &&
      (!Array.isArray(message.sources) || !message.sources.every(isTurnSource))) return false;
  if (message.toolResults !== undefined &&
      (!Array.isArray(message.toolResults) || !message.toolResults.every(isToolResult))) return false;
  return typeof message.diff === "string";
}

export function applyChatStreamEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  if (event.type === "snapshot") return event.message;
  if (event.type === "content") return { ...message, content: event.value };
  if (event.type === "delta") return { ...message, content: message.content + event.value };
  if (event.type === "activity") {
    const index = message.activity.findIndex((item) => item.id === event.item.id);
    if (index === -1) return { ...message, activity: [...message.activity, event.item] };
    const activity = [...message.activity];
    activity[index] = event.item;
    return { ...message, activity };
  }
  if (event.type === "plan") return { ...message, plan: event.steps };
  if (event.type === "approval") {
    const index = message.approvals.findIndex((item) => item.id === event.item.id);
    if (index === -1) return { ...message, approvals: [...message.approvals, event.item] };
    const approvals = [...message.approvals];
    approvals[index] = event.item;
    return { ...message, approvals };
  }
  if (event.type === "diff") return { ...message, diff: event.value };
  if (event.type === "artifact") {
    const index = message.artifacts.findIndex((artifact) => artifact.id === event.item.id);
    if (index === -1) return { ...message, artifacts: [...message.artifacts, event.item] };
    const artifacts = [...message.artifacts];
    artifacts[index] = event.item;
    return { ...message, artifacts };
  }
  if (event.type === "source") {
    const sources = message.sources ?? [];
    const index = sources.findIndex((source) => source.id === event.item.id);
    if (index === -1) return { ...message, sources: [...sources, event.item] };
    const next = [...sources];
    next[index] = event.item;
    return { ...message, sources: next };
  }
  if (event.type === "toolResult") {
    const toolResults = message.toolResults ?? [];
    const index = toolResults.findIndex((result) => result.id === event.item.id);
    if (index === -1) return { ...message, toolResults: [...toolResults, event.item] };
    const next = [...toolResults];
    next[index] = event.item;
    return { ...message, toolResults: next };
  }
  if (event.type === "done") return { ...message, status: "complete" };
  if (event.type === "stopped") return { ...message, status: "stopped" };
  if (event.type === "error") {
    return { ...message, status: "error", content: message.content || event.message };
  }
  return message;
}
