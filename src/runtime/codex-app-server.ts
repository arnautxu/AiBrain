import { createHash } from "node:crypto";
import type {
  ActivityItem,
  ApprovalDecision,
  ApprovalItem,
  ChatRequest,
  ChatStreamEvent,
  PlanStep,
} from "@/lib/chat-contract";
import type { ApprovalRequestType } from "@/runtime/approval-store";
import type { RuntimeConfig } from "@/runtime/config";
import type {
  RuntimeModelOption,
  RuntimeReasoningEffort,
  RuntimeSkillOption,
} from "@/lib/runtime-status";

export type LegacyServerRequest = {
  kind: "serverRequest";
  id: number | string;
  method: string;
  params: unknown;
};
type ServerRequest = LegacyServerRequest;
export type CodexTurnEvent = ChatStreamEvent | {
  type: "runtimeThread";
  threadToken: string;
};

export type CodexConnection = {
  connected: boolean;
  authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
  planType: string | null;
  models: RuntimeModelOption[];
  skills: RuntimeSkillOption[];
  webSearch: boolean;
  imageGeneration: boolean;
  processWarm: boolean;
  rateLimit: {
    usedPercent: number;
    windowDurationMins: number | null;
    resetsAt: number | null;
  } | null;
  usage: {
    lifetimeTokens: number | null;
    currentStreakDays: number | null;
    longestRunningTurnSec: number | null;
  } | null;
};

export class RuntimeNotReadyError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function extractThreadId(result: unknown) {
  if (!isRecord(result) || !isRecord(result.thread)) return null;
  return typeof result.thread.id === "string" ? result.thread.id : null;
}

export function extractTurnId(result: unknown) {
  if (!isRecord(result) || !isRecord(result.turn)) return null;
  return typeof result.turn.id === "string" ? result.turn.id : null;
}

export function parseAccount(result: unknown): CodexConnection {
  if (!isRecord(result) || !isRecord(result.account)) {
    return { connected: false, authMode: null, planType: null, models: [], skills: [], webSearch: false, imageGeneration: false, processWarm: false, rateLimit: null, usage: null };
  }

  const account = result.account;
  if (account.type === "chatgpt") {
    return {
      connected: true,
      authMode: "chatgpt",
      planType: typeof account.planType === "string" ? account.planType : null,
      models: [], skills: [], webSearch: false, imageGeneration: false, processWarm: false, rateLimit: null, usage: null,
    };
  }
  if (account.type === "apiKey") {
    return { connected: false, authMode: "apiKey", planType: null, models: [], skills: [], webSearch: false, imageGeneration: false, processWarm: false, rateLimit: null, usage: null };
  }
  if (account.type === "amazonBedrock") {
    return { connected: false, authMode: "amazonBedrock", planType: null, models: [], skills: [], webSearch: false, imageGeneration: false, processWarm: false, rateLimit: null, usage: null };
  }

  return { connected: false, authMode: null, planType: null, models: [], skills: [], webSearch: false, imageGeneration: false, processWarm: false, rateLimit: null, usage: null };
}

const reasoningEfforts = new Set<RuntimeReasoningEffort>([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
]);

function reasoningEffort(value: unknown): RuntimeReasoningEffort | null {
  return typeof value === "string" && reasoningEfforts.has(value as RuntimeReasoningEffort)
    ? value as RuntimeReasoningEffort
    : null;
}

export function parseModels(result: unknown): RuntimeModelOption[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  return result.data.flatMap((model) => {
    if (!isRecord(model) || typeof model.model !== "string" || model.hidden === true) return [];
    const modalities = Array.isArray(model.inputModalities)
      ? model.inputModalities.filter((item): item is "text" | "image" | "audio" => item === "text" || item === "image" || item === "audio")
      : ["text" as const];
    return [{
      id: model.model,
      label: typeof model.displayName === "string" ? model.displayName : model.model,
      description: typeof model.description === "string" ? model.description : "Model disponible al runtime",
      isDefault: model.isDefault === true,
      inputModalities: modalities,
      supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.flatMap((option) => {
            const value = isRecord(option) ? option.reasoningEffort : option;
            const parsed = reasoningEffort(value);
            return parsed ? [parsed] : [];
          })
        : [],
      defaultReasoningEffort: reasoningEffort(model.defaultReasoningEffort),
      supportsPersonality: model.supportsPersonality === true,
    }];
  }).slice(0, 24);
}

export type ResolvedSkill = RuntimeSkillOption & { path: string };

export function parseSkills(result: unknown): ResolvedSkill[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  const resolved: ResolvedSkill[] = [];
  for (const entry of result.data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      if (!isRecord(skill) || skill.enabled !== true || typeof skill.name !== "string" || typeof skill.path !== "string") continue;
      resolved.push({
        id: skill.name,
        label: isRecord(skill.interface) && typeof skill.interface.displayName === "string" ? skill.interface.displayName : skill.name,
        description: typeof skill.description === "string" ? skill.description : "Skill del workspace",
        path: skill.path,
      });
    }
  }
  return [...new Map(resolved.map((skill) => [skill.id, skill])).values()].slice(0, 80);
}

export function parseRateLimit(result: unknown): CodexConnection["rateLimit"] {
  if (!isRecord(result) || !isRecord(result.rateLimits) || !isRecord(result.rateLimits.primary)) return null;
  const primary = result.rateLimits.primary;
  if (typeof primary.usedPercent !== "number") return null;
  return {
    usedPercent: Math.max(0, Math.min(100, primary.usedPercent)),
    windowDurationMins: typeof primary.windowDurationMins === "number" ? primary.windowDurationMins : null,
    resetsAt: typeof primary.resetsAt === "number" ? primary.resetsAt : null,
  };
}

export function parseUsage(result: unknown): CodexConnection["usage"] {
  if (!isRecord(result) || !isRecord(result.summary)) return null;
  const summary = result.summary;
  const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    lifetimeTokens: metric(summary.lifetimeTokens),
    currentStreakDays: metric(summary.currentStreakDays),
    longestRunningTurnSec: metric(summary.longestRunningTurnSec),
  };
}

function statusFromItem(value: unknown, completed: boolean): ActivityItem["status"] {
  if (value === "failed") return "failed";
  if (value === "declined") return "stopped";
  if (value === "completed" || completed) return "complete";
  return "running";
}

function joinedStrings(value: unknown) {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings.join("\n") : null;
}

function fileChangeSummary(changes: unknown) {
  if (!Array.isArray(changes)) return null;
  const paths = changes.flatMap((change) =>
    isRecord(change) && typeof change.path === "string" ? [change.path] : [],
  );
  return paths.length > 0 ? paths.join(", ") : null;
}

export function itemActivity(params: unknown, completed: boolean): ActivityItem | null {
  if (!isRecord(params) || !isRecord(params.item)) return null;
  const item = params.item;
  if (typeof item.id !== "string" || typeof item.type !== "string") return null;

  const status = statusFromItem(item.status, completed);

  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "Ordre de terminal";
    return {
      id: item.id,
      kind: "command",
      label: status === "running" ? "Executant una ordre" : "Ordre executada",
      detail: command,
      ...(typeof item.aggregatedOutput === "string"
        ? { output: item.aggregatedOutput }
        : {}),
      status,
    };
  }

  if (item.type === "fileChange") {
    return {
      id: item.id,
      kind: "file",
      label: status === "running" ? "Preparant canvis" : "Canvis de fitxers",
      ...(fileChangeSummary(item.changes)
        ? { detail: fileChangeSummary(item.changes) ?? undefined }
        : {}),
      status,
    };
  }

  if (item.type === "mcpToolCall") {
    const server = typeof item.server === "string" ? item.server : "MCP";
    const tool = typeof item.tool === "string" ? item.tool : "eina";
    return {
      id: item.id,
      kind: "tool",
      label: status === "running" ? `Utilitzant ${tool}` : `${tool} completat`,
      detail: server,
      status,
    };
  }

  if (item.type === "dynamicToolCall") {
    const tool = typeof item.tool === "string" ? item.tool : "Eina";
    return {
      id: item.id,
      kind: "tool",
      label: status === "running" ? `Utilitzant ${tool}` : `${tool} completat`,
      ...(typeof item.namespace === "string" ? { detail: item.namespace } : {}),
      status,
    };
  }

  if (item.type === "webSearch") {
    return {
      id: item.id,
      kind: "web",
      label: status === "running" ? "Cercant al web" : "Cerca web completada",
      ...(typeof item.query === "string" ? { detail: item.query } : {}),
      status,
    };
  }

  if (item.type === "reasoning") {
    return {
      id: item.id,
      kind: "reasoning",
      label: status === "running" ? "Raonant" : "Raonament completat",
      ...(joinedStrings(item.summary) ? { detail: joinedStrings(item.summary) ?? undefined } : {}),
      status,
    };
  }

  if (item.type === "plan") {
    return {
      id: item.id,
      kind: "plan",
      label: status === "running" ? "Preparant el pla" : "Pla preparat",
      ...(typeof item.text === "string" ? { detail: item.text } : {}),
      status,
    };
  }

  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") {
    return {
      id: item.id,
      kind: "agent",
      label: status === "running" ? "Coordinant agents" : "Coordinació completada",
      ...(typeof item.tool === "string" ? { detail: item.tool } : {}),
      status,
    };
  }

  return null;
}

export function notificationDelta(params: unknown) {
  return isRecord(params) && typeof params.delta === "string" ? params.delta : null;
}

export function notificationItemId(params: unknown) {
  return isRecord(params) && typeof params.itemId === "string" ? params.itemId : null;
}

export function planFromNotification(params: unknown): {
  explanation: string | null;
  steps: PlanStep[];
} | null {
  if (!isRecord(params) || !Array.isArray(params.plan)) return null;

  const steps: PlanStep[] = [];
  for (const value of params.plan) {
    if (!isRecord(value) || typeof value.step !== "string") continue;
    if (value.status === "pending" || value.status === "completed") {
      steps.push({ step: value.step, status: value.status });
    } else if (value.status === "inProgress") {
      steps.push({ step: value.step, status: "in_progress" });
    }
  }

  return {
    explanation: typeof params.explanation === "string" ? params.explanation : null,
    steps,
  };
}

export function completedTurnStatus(params: unknown) {
  if (!isRecord(params) || !isRecord(params.turn)) return null;
  const turn = params.turn;
  const error = isRecord(turn.error) ? turn.error : null;
  return {
    status: typeof turn.status === "string" ? turn.status : null,
    error: error && typeof error.message === "string" ? error.message : null,
  };
}

export type PendingServerApproval = {
  item: ApprovalItem;
  requestType: ApprovalRequestType;
  response: (decision: ApprovalDecision | "cancel") => object;
};

function approvalRouting(request: ServerRequest) {
  if (!isRecord(request.params)) return null;
  const { threadId, turnId, itemId } = request.params;
  const valid = (value: unknown) => typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
  if (!valid(threadId) || !valid(turnId) || !valid(itemId)) return null;
  const explicitApprovalId = request.params.approvalId;
  if (explicitApprovalId !== undefined && explicitApprovalId !== null &&
      !valid(explicitApprovalId)) return null;
  const approvalId = typeof explicitApprovalId === "string"
    ? explicitApprovalId
    : `approval-${createHash("sha256").update(JSON.stringify([
        request.method,
        threadId,
        turnId,
        itemId,
      ])).digest("hex")}`;
  return {
    id: approvalId,
    threadId: threadId as string,
    turnId: turnId as string,
    itemId: itemId as string,
  };
}

function permissionGrant(value: unknown) {
  if (!isRecord(value)) return {};
  const grant: Record<string, unknown> = {};
  if (value.network !== null && value.network !== undefined) {
    grant.network = value.network;
  }
  if (value.fileSystem !== null && value.fileSystem !== undefined) {
    grant.fileSystem = value.fileSystem;
  }
  return grant;
}

function permissionSummary(value: unknown) {
  if (!isRecord(value)) return null;
  const parts: string[] = [];
  if (isRecord(value.fileSystem)) {
    const read = joinedStrings(value.fileSystem.read);
    const write = joinedStrings(value.fileSystem.write);
    if (read) parts.push(`Lectura: ${read}`);
    if (write) parts.push(`Escriptura: ${write}`);
  }
  if (isRecord(value.network) && value.network.enabled === true) {
    parts.push("Accés de xarxa");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function approvalFromRequest(request: ServerRequest): PendingServerApproval | null {
  if (!isRecord(request.params)) return null;
  const params = request.params;
  const routing = approvalRouting(request);
  if (!routing) return null;
  const reason = typeof params.reason === "string" ? params.reason : null;

  if (request.method === "item/commandExecution/requestApproval") {
    const command = typeof params.command === "string" ? params.command : null;
    return {
      item: {
        ...routing,
        kind: "command",
        title: "Em dones permís per completar aquest pas?",
        detail: reason ?? command ?? "Revisa l’ordre abans de continuar.",
        ...(command ? { command } : {}),
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
        status: "pending",
      },
      requestType: "command",
      response: (decision) => ({ decision }),
    };
  }

  if (request.method === "item/fileChange/requestApproval") {
    return {
      item: {
        ...routing,
        kind: "file",
        title: "Vols que apliqui aquests canvis?",
        detail: reason ?? "Revisa els canvis abans de continuar.",
        status: "pending",
      },
      requestType: "file",
      response: (decision) => ({ decision }),
    };
  }

  if (request.method === "item/permissions/requestApproval") {
    const requested = isRecord(params.permissions) ? params.permissions : {};
    return {
      item: {
        ...routing,
        kind: "command",
        title: "Codex demana permisos addicionals",
        detail:
          reason ??
          permissionSummary(requested) ??
          "Revisa els permisos abans de continuar.",
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
        status: "pending",
      },
      requestType: "permissions",
      response: (decision) => ({
        permissions:
          decision === "decline" || decision === "cancel"
            ? {}
            : permissionGrant(requested),
        scope: decision === "acceptForSession" ? "session" : "turn",
      }),
    };
  }

  return null;
}

export function resolvedApproval(
  approval: ApprovalItem,
  decision: ApprovalDecision | "cancel",
): ApprovalItem {
  const status =
    decision === "accept"
      ? "accepted"
      : decision === "acceptForSession"
        ? "accepted_session"
        : "declined";
  return { ...approval, status };
}

export function effectiveSandbox(config: RuntimeConfig, chatRequest: ChatRequest) {
  return chatRequest.options.mode === "agent" ? config.sandbox : "read-only";
}

export function sandboxPolicy(config: RuntimeConfig, chatRequest: ChatRequest) {
  if (effectiveSandbox(config, chatRequest) === "read-only") {
    return { type: "readOnly" as const, networkAccess: false };
  }
  return {
    type: "workspaceWrite" as const,
    writableRoots: [config.workspace],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}
