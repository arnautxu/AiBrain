import { createHash } from "node:crypto";
import type { AuthSession } from "@/auth/types";
import type { InstallationConfig } from "@/config/installation-schema";
import type { ChatMessage, ChatRequest, ChatStreamEvent } from "@/lib/chat-contract";
import { applyChatStreamEvent } from "@/lib/chat-contract";
import { readRuntimeConfig } from "@/runtime/config";
import { FileApprovalStore } from "@/runtime/approval-store";
import { LocalFileMemoryService } from "@/memory";
import { FileMemoryTurnAuditSink } from "@/runtime/memory-turn";
import { resolveServerTurnPermissions } from "@/runtime/permission-turn";
import { runWorkerCodexTurn, type WorkerCodexTurnEvent } from "@/runtime/worker-codex-turn";
import {
  beginThreadTurn,
  createThread,
  finishThreadTurn,
  getThreadRuntimeContext,
} from "@/workbench/store";
import type { AutomationTask } from "@/automations/contracts";

function stableUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = "8";
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function message(id: string, role: ChatMessage["role"], content: string, status: ChatMessage["status"], createdAt: string): ChatMessage {
  return {
    id,
    role,
    content,
    status,
    createdAt,
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    attachments: [],
    artifacts: [],
    sources: [],
    toolResults: [],
  };
}

export type ScheduledExecutionInput = {
  installation: Readonly<InstallationConfig>;
  session: AuthSession;
  task: AutomationTask;
  runKey: string;
  existingThreadId?: string | null;
  onThreadPrepared?: (threadId: string) => Promise<void>;
  signal?: AbortSignal;
};

/** Executes the prompt as a real persistent AiBrain turn. It never sends an external message by itself. */
export async function executeScheduledTurn(input: ScheduledExecutionInput) {
  const signal = input.signal ?? new AbortController().signal;
  const thread = input.existingThreadId
    ? null
    : await createThread(input.session, input.task.projectId, `Programada · ${input.task.name}`);
  const threadId = input.existingThreadId ?? thread?.id;
  if (!threadId) throw new Error("No se ha podido preparar la conversación programada.");
  await input.onThreadPrepared?.(threadId);
  const context = await getThreadRuntimeContext(input.session, threadId);
  if (context.projectId !== input.task.projectId) throw new Error("El proyecto de la automatización ha cambiado.");
  const runtimeConfig = readRuntimeConfig(input.installation.installationId, context.workspaceKey);
  if (runtimeConfig.mode !== "codex") throw new Error("El runtime real de Codex no está activo.");

  const userMessageId = stableUuid(`${input.runKey}:user`);
  const assistantMessageId = stableUuid(`${input.runKey}:assistant`);
  const startedAt = new Date().toISOString();
  const request: ChatRequest = {
    projectId: input.task.projectId,
    threadId,
    userMessageId,
    assistantMessageId,
    message: input.task.prompt,
    preferences: { tone: "balanced", language: "es", showActivity: true },
    options: {
      mode: "agent",
      model: null,
      effort: null,
      webSearch: false,
      imageGeneration: false,
      skill: null,
      attachments: [],
    },
  };
  const userMessage = message(userMessageId, "user", input.task.prompt, "complete", startedAt);
  let assistantMessage = message(assistantMessageId, "assistant", "", "streaming", new Date(Date.now() + 1).toISOString());
  const begun = await beginThreadTurn(input.session, threadId, userMessage, assistantMessage);
  assistantMessage = begun.assistantMessage;
  if (begun.outcome === "existing" && assistantMessage.status !== "streaming") {
    if (assistantMessage.status !== "complete") throw new Error(assistantMessage.content || "La ejecución anterior falló.");
    return { threadId };
  }

  const permissions = await resolveServerTurnPermissions(input.installation, {
    installationId: input.installation.installationId,
    userId: input.session.user.id,
    projectId: input.task.projectId,
    turnId: assistantMessageId,
  });
  const approvals = new FileApprovalStore({
    installationId: input.installation.installationId,
    userId: input.session.user.id,
    usersRoot: input.installation.paths.usersRoot,
  });
  const memory = {
    memoryService: new LocalFileMemoryService({ config: input.installation }),
    auditSink: new FileMemoryTurnAuditSink({
      installationId: input.installation.installationId,
      userId: input.session.user.id,
      usersRoot: input.installation.paths.usersRoot,
    }),
  };
  let runtimeThreadToken: string | null = null;
  const emit = async (event: WorkerCodexTurnEvent) => {
    if (event.type === "runtimeThread") {
      runtimeThreadToken = event.threadToken;
      return;
    }
    if (event.type === "runtimeTurn" || event.type === "runtimeUsage") return;
    assistantMessage = applyChatStreamEvent(assistantMessage, event as ChatStreamEvent);
  };

  try {
    await runWorkerCodexTurn(
      request,
      input.installation.installationId,
      input.session.user.id,
      null,
      runtimeConfig,
      permissions,
      approvals,
      memory,
      [],
      signal,
      emit,
      undefined,
      input.installation.branding.productName,
      context,
    );
  } catch (error) {
    assistantMessage = applyChatStreamEvent(assistantMessage, {
      type: "error",
      message: error instanceof Error ? error.message : "La ejecución programada ha fallado.",
    });
  }
  if (assistantMessage.status === "streaming") assistantMessage = { ...assistantMessage, status: "error" };
  await finishThreadTurn(input.session, threadId, assistantMessage, runtimeThreadToken);
  if (assistantMessage.status !== "complete") throw new Error(assistantMessage.content || "La ejecución programada ha fallado.");
  return { threadId };
}
