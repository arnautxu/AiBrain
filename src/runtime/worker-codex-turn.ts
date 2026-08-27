import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ServerNotification } from "../../contracts/codex/0.149.1/types/ServerNotification";
import type { ServerRequest } from "../../contracts/codex/0.149.1/types/ServerRequest";
import type {
  ActivityItem,
  ChatRequest,
} from "@/lib/chat-contract";
import type { ResolvedPermissions } from "@/permissions";
import {
  approvalFromRequest,
  completedTurnStatus,
  effectiveSandbox,
  extractThreadId,
  extractTurnId,
  itemActivity,
  notificationDelta,
  notificationItemId,
  planFromNotification,
  resolvedApproval,
  RuntimeNotReadyError,
  sandboxPolicy,
  type CodexTurnEvent,
  type LegacyServerRequest,
} from "@/runtime/codex-app-server";
import type { RuntimeConfig } from "@/runtime/config";
import {
  approvalLocatorFromItem,
  waitForApproval,
  type FileApprovalStore,
} from "@/runtime/approval-store";
import {
  BROWSER_DYNAMIC_TOOLS,
  handleBrowserDynamicToolCall,
} from "@/runtime/browser/dynamic-tools";
import { executeBrowserAgentCommand } from "@/runtime/browser/server-service";
import {
  assertCodexTurnPermissionBinding,
  buildCodexDeveloperInstructions,
  permissionAllowsGenericToolExecution,
} from "@/runtime/permission-turn";
import {
  prepareTurnMemory,
  type WorkerTurnMemoryDependencies,
} from "@/runtime/memory-turn";
import { issueThreadToken } from "@/runtime/thread-token";
import {
  acquireWorkerTurnActivity,
  registerWorkerTurnCancellation,
  workerAppServerForUser,
} from "@/runtime/worker-runtime-service";
import { resolveWorkerOwnedPath } from "@/runtime/workers/provisioner";
import type { JsonValue } from "@/runtime/transport";
import type { AppServerEvent } from "@/runtime/transport";
import { atomicWriteFile } from "@/storage";
import {
  assertWorkerTurnDocuments,
  turnDocumentCodexInputs,
  type ResolvedTurnDocument,
} from "@/documents/turn-attachments";
import { operationalLogger } from "@/operations/server-logger";
import type { MaintenanceActivityLease } from "@/operations/maintenance";

export type WorkerTurnProjection = {
  envelope: AppServerEvent;
  key: string;
};

export type WorkerCodexTurnEvent = CodexTurnEvent | {
  type: "runtimeTurn";
  turnId: string;
};

type EmitEvent = (
  event: WorkerCodexTurnEvent,
  projection?: WorkerTurnProjection,
) => Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type RecoveredTurn = {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: string | null;
  items: Record<string, unknown>[];
};

function recoveredTurn(result: unknown, clientUserMessageId: string): RecoveredTurn | null {
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) return null;
  for (const candidate of [...result.thread.turns].reverse()) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" ||
        !["completed", "interrupted", "failed", "inProgress"].includes(String(candidate.status)) ||
        !Array.isArray(candidate.items)) continue;
    const items = candidate.items.filter(isRecord);
    const matches = items.some((item) =>
      item.type === "userMessage" && item.clientId === clientUserMessageId);
    if (!matches) continue;
    return {
      id: candidate.id,
      status: candidate.status as RecoveredTurn["status"],
      error: isRecord(candidate.error) && typeof candidate.error.message === "string"
        ? candidate.error.message
        : null,
      items,
    };
  }
  return null;
}

function recoveredAgentText(turn: RecoveredTurn) {
  const messages = turn.items.filter((item) => item.type === "agentMessage" && typeof item.text === "string");
  const final = messages.filter((item) => item.phase === "final_answer").at(-1) ?? messages.at(-1);
  return final && typeof final.text === "string" ? final.text : null;
}

function legacyServerRequest(request: ServerRequest): LegacyServerRequest {
  return {
    kind: "serverRequest",
    id: request.id,
    method: request.method,
    params: request.params,
  };
}

function deterministicArtifactId(eventId: string, itemId: string) {
  const digest = createHash("sha256").update(`${eventId}\0${itemId}`).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function persistGeneratedImage(
  params: unknown,
  projectWorkspace: string,
  projectId: string,
  envelope: AppServerEvent,
  emit: EmitEvent,
) {
  if (!isRecord(params) || !isRecord(params.item) || params.item.type !== "imageGeneration") return;
  const item = params.item;
  if (typeof item.result !== "string" || item.result.length === 0) return;
  const encoded = item.result.includes(",") ? item.result.slice(item.result.indexOf(",") + 1) : item.result;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > 20_000_000) return;
  const artifactId = deterministicArtifactId(envelope.eventId, String(item.id ?? "image"));
  const artifactRoot = path.join(projectWorkspace, ".aibrain", "artifacts");
  await atomicWriteFile(path.join(artifactRoot, `${artifactId}.png`), bytes, { mode: 0o600 });
  await emit({
    type: "artifact",
    item: {
      id: artifactId,
      type: "image",
      name: `imatge-${artifactId.slice(0, 8)}.png`,
      url: `/api/projects/${projectId}/artifacts/${artifactId}`,
      prompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : null,
    },
  }, { envelope, key: `artifact:${String(item.id ?? artifactId)}` });
}

/**
 * Runs one UI turn through the authenticated per-employee private WebSocket
 * gateway. The router owns events by runtime thread and turn, so concurrent
 * users and concurrent threads never share mutable handlers.
 */
export async function runWorkerCodexTurn(
  chatRequest: ChatRequest,
  installationId: string,
  authenticatedUserId: string,
  runtimeThreadId: string | null,
  runtimeConfig: RuntimeConfig,
  permissions: ResolvedPermissions,
  approvalStore: FileApprovalStore,
  memory: WorkerTurnMemoryDependencies,
  turnDocuments: readonly ResolvedTurnDocument[],
  signal: AbortSignal,
  emit: EmitEvent,
  admittedMaintenanceActivity?: MaintenanceActivityLease,
  assistantName = "AiBrain",
) {
  const ownsMaintenanceActivity = !admittedMaintenanceActivity;
  const maintenanceActivity = admittedMaintenanceActivity ?? await acquireWorkerTurnActivity();
  try {
  if (runtimeConfig.mode !== "codex") {
    throw new RuntimeNotReadyError("El runtime real de Codex no està activat.");
  }
  if (signal.aborted) throw new RuntimeNotReadyError("El torn s’ha cancel·lat abans de començar.");
  assertCodexTurnPermissionBinding(
    chatRequest,
    installationId,
    authenticatedUserId,
    permissions,
  );
  const preparedMemory = await prepareTurnMemory(memory, {
    installationId,
    userId: authenticatedUserId,
    projectId: chatRequest.projectId,
    turnId: chatRequest.assistantMessageId,
    permissionFingerprint: permissions.fingerprint,
  });

  const runtime = await workerAppServerForUser(authenticatedUserId, maintenanceActivity);
  if (runtime.config.installationId !== installationId) {
    throw new RuntimeNotReadyError("La instal·lació del worker no coincideix amb la sessió.");
  }
  const documentUploadIds = chatRequest.options.documentUploadIds ?? [];
  if (documentUploadIds.length > 0 || turnDocuments.length > 0) {
    assertWorkerTurnDocuments({
      documents: turnDocuments,
      stagingRoot: runtime.handle.roots.staging,
      threadId: chatRequest.threadId,
      uploadIds: documentUploadIds,
      permissions,
    });
  }
  const projectWorkspace = await resolveWorkerOwnedPath(
    runtime.handle.roots.workspace,
    path.posix.join("projects", chatRequest.projectId),
  );
  await mkdir(projectWorkspace, { recursive: true, mode: 0o700 });
  const account = await runtime.client.connection(projectWorkspace);
  if (!account.connected) throw new RuntimeNotReadyError("Cal connectar un compte de Codex dedicat.");

  const activities = new Map<string, ActivityItem>();
  const upsertActivity = async (item: ActivityItem, projection?: WorkerTurnProjection) => {
    activities.set(item.id, item);
    if (chatRequest.preferences.showActivity) await emit({ type: "activity", item }, projection);
  };
  await upsertActivity({
    id: "codex-connected",
    kind: "system",
    label: "Codex connectat",
    detail: account.planType ? `Pla ${account.planType}` : "Sessió dedicada verificada",
    status: "complete",
  });

  let selectedModel = chatRequest.options.model ?? runtimeConfig.model;
  let selectedModelOption = selectedModel
    ? account.models.find((model) => model.id === selectedModel) ?? null
    : account.models.find((model) => model.isDefault) ?? account.models[0] ?? null;
  if (chatRequest.options.model) {
    selectedModelOption = account.models.find((model) => model.id === chatRequest.options.model) ?? null;
    if (!selectedModelOption) throw new Error("El model seleccionat ja no està disponible.");
  }
  selectedModel = selectedModel ?? selectedModelOption?.id ?? null;
  if (selectedModelOption && chatRequest.options.attachments.length > 0 &&
      !selectedModelOption.inputModalities.includes("image")) {
    throw new Error("El model seleccionat no admet imatges.");
  }
  if (selectedModelOption && chatRequest.options.effort &&
      selectedModelOption.supportedReasoningEfforts.length > 0 &&
      !selectedModelOption.supportedReasoningEfforts.includes(chatRequest.options.effort)) {
    throw new Error("El nivell de raonament seleccionat no és compatible amb aquest model.");
  }
  if (chatRequest.options.webSearch && !account.webSearch) {
    throw new Error("La cerca web no està disponible en aquest runtime.");
  }
  if (chatRequest.options.imageGeneration && !account.imageGeneration) {
    throw new Error("La generació d’imatges no està disponible en aquest runtime.");
  }
  const selectedSkill = chatRequest.options.skill
    ? (await runtime.client.resolvedSkills(projectWorkspace))
      .find((skill) => skill.id === chatRequest.options.skill) ?? null
    : null;
  if (chatRequest.options.skill && !selectedSkill) {
    throw new Error("La skill seleccionada ja no està disponible.");
  }

  const commonThreadParams = {
    ...(selectedModel ? { model: selectedModel } : {}),
    cwd: projectWorkspace,
    runtimeWorkspaceRoots: [projectWorkspace],
    approvalPolicy: runtimeConfig.approvalPolicy,
    approvalsReviewer: "user",
    sandbox: effectiveSandbox(runtimeConfig, chatRequest),
    config: { web_search: chatRequest.options.webSearch ? "live" : "disabled" },
    developerInstructions: [
      buildCodexDeveloperInstructions(chatRequest, permissions, assistantName),
      preparedMemory.developerInstructions,
    ].join("\n\n"),
  };
  let recovered: RecoveredTurn | null = null;
  const persistThreadIdentity = async (result: JsonValue, envelope: AppServerEvent) => {
    const resolvedThreadId = extractThreadId(result);
    if (!resolvedThreadId) throw new Error("Codex no ha retornat cap thread vàlid.");
    await emit({
      type: "runtimeThread",
      threadToken: issueThreadToken(installationId, authenticatedUserId, resolvedThreadId),
    });
    recovered = recoveredTurn(result, chatRequest.userMessageId);
    if (!recovered) return;
    await emit({ type: "runtimeTurn", turnId: recovered.id });
    const text = recoveredAgentText(recovered);
    if (text !== null) {
      await emit(
        { type: "content", value: text },
        { envelope, key: `recovery:content:${recovered.id}` },
      );
    }
    for (const item of recovered.items) {
      if (item.type === "imageGeneration") {
        await persistGeneratedImage(
          { item },
          projectWorkspace,
          chatRequest.projectId,
          envelope,
          emit,
        );
      }
      const activity = itemActivity({ item }, true);
      if (activity) {
        activities.set(activity.id, activity);
        if (chatRequest.preferences.showActivity) {
          await emit(
            { type: "activity", item: activity },
            { envelope, key: `recovery:activity:${activity.id}` },
          );
        }
      }
    }
    if (recovered.status === "completed") {
      await emit({ type: "done" }, { envelope, key: `recovery:done:${recovered.id}` });
    } else if (recovered.status === "failed") {
      await emit(
        { type: "error", message: recovered.error ?? "El torn recuperat ha fallat." },
        { envelope, key: `recovery:error:${recovered.id}` },
      );
    } else if (recovered.status === "interrupted") {
      await emit({ type: "stopped" }, { envelope, key: `recovery:stopped:${recovered.id}` });
    }
  };
  const threadResult = runtimeThreadId
    ? await runtime.client.request("thread/resume", {
        threadId: runtimeThreadId,
        ...commonThreadParams,
      }, `thread-resume:${chatRequest.assistantMessageId}`, 60_000, persistThreadIdentity)
    : await runtime.client.request("thread/start", {
        ...commonThreadParams,
        dynamicTools: [...BROWSER_DYNAMIC_TOOLS],
        ephemeral: false,
        serviceName: "aibrain_workbench",
      }, `thread-start:${chatRequest.threadId}`, 60_000, persistThreadIdentity);
  const threadId = extractThreadId(threadResult);
  if (!threadId) throw new Error("Codex no ha retornat cap thread vàlid.");
  recovered = recoveredTurn(threadResult, chatRequest.userMessageId) ?? recovered;
  const recoveredState = recovered as RecoveredTurn | null;
  if (recoveredState && recoveredState.status !== "inProgress") return;

  let runtimeTurnId: string | null = null;
  let remoteInterruptConfirmed = false;
  const turnController = new AbortController();
  const forwardExternalAbort = () => turnController.abort();
  const turnSignal = turnController.signal;
  let finishTurn!: (status: { status: string | null; error: string | null }) => void;
  const turnFinished = new Promise<{ status: string | null; error: string | null }>((resolve) => {
    finishTurn = resolve;
  });
  const runtimeStartedAt = performance.now();
  let firstDeltaAt: number | null = null;
  let stoppedEmitted = false;

  const registration = runtime.client.router.registerTurn(
    threadId,
    chatRequest.assistantMessageId,
    {
      onNotification: async (notification: ServerNotification, envelope: AppServerEvent) => {
        const { method, params } = notification;
        if (method === "item/agentMessage/delta") {
          const delta = notificationDelta(params);
          if (delta) {
            firstDeltaAt ??= performance.now();
            await emit(
              { type: "delta", value: delta },
              { envelope, key: `delta:${notificationItemId(params) ?? "agent"}` },
            );
          }
          return;
        }
        if (method === "item/started" || method === "item/completed") {
          if (method === "item/completed") {
            await persistGeneratedImage(
              params,
              projectWorkspace,
              chatRequest.projectId,
              envelope,
              emit,
            );
          }
          const activity = itemActivity(params, method === "item/completed");
          if (activity) {
            await upsertActivity(activity, {
              envelope,
              key: `activity:${method === "item/completed" ? "completed" : "started"}:${activity.id}`,
            });
          }
          return;
        }
        if (method === "item/commandExecution/outputDelta") {
          const itemId = notificationItemId(params);
          const delta = notificationDelta(params);
          if (!itemId || !delta) return;
          const current = activities.get(itemId) ?? {
            id: itemId,
            kind: "command",
            label: "Executant una ordre",
            status: "running",
          } satisfies ActivityItem;
          await upsertActivity(
            { ...current, output: `${current.output ?? ""}${delta}` },
            { envelope, key: `command-output:${itemId}` },
          );
          return;
        }
        if (method === "item/reasoning/summaryTextDelta") {
          const itemId = notificationItemId(params);
          const delta = notificationDelta(params);
          if (!itemId || !delta) return;
          const current = activities.get(itemId) ?? {
            id: itemId,
            kind: "reasoning",
            label: "Raonant",
            status: "running",
          } satisfies ActivityItem;
          await upsertActivity(
            { ...current, detail: `${current.detail ?? ""}${delta}` },
            { envelope, key: `reasoning-summary:${itemId}` },
          );
          return;
        }
        if (method === "turn/plan/updated") {
          const plan = planFromNotification(params);
          if (plan) await emit({ type: "plan", ...plan }, { envelope, key: "turn:plan" });
          return;
        }
        if (method === "turn/diff/updated" && isRecord(params) && typeof params.diff === "string") {
          await emit({ type: "diff", value: params.diff }, { envelope, key: "turn:diff" });
          return;
        }
        if (method === "warning" || method === "error") {
          if (!isRecord(params)) return;
          const warning = params as unknown as Record<string, unknown>;
          const message = typeof warning.message === "string"
            ? warning.message
            : typeof warning.error === "string" ? warning.error : null;
          if (message) {
            await upsertActivity({
              id: `runtime-${randomUUID()}`,
              kind: "system",
              label: method === "error" ? "Error del runtime" : "Avís del runtime",
              detail: message,
              status: method === "error" ? "failed" : "complete",
            }, { envelope, key: `runtime:${method}` });
          }
          return;
        }
        if (method === "turn/completed") {
          const status = completedTurnStatus(params) ?? {
            status: null,
            error: "Resposta incompleta de Codex.",
          };
          if (status.status === "failed") {
            await emit(
              { type: "error", message: status.error ?? "El torn de Codex ha fallat." },
              { envelope, key: "turn:error" },
            );
          } else if (status.status === "completed") {
            await emit({ type: "done" }, { envelope, key: "turn:done" });
          } else if (status.status === "interrupted") {
            await emit({ type: "stopped" }, { envelope, key: "turn:stopped" });
            stoppedEmitted = true;
          }
          finishTurn(status);
        }
      },
      onServerRequest: async (request: ServerRequest, envelope: AppServerEvent) => {
        if (request.method === "item/tool/call") {
          if (!runtimeTurnId) throw new Error("Browser tool call arrived before the turn was bound.");
          return await handleBrowserDynamicToolCall(request.params, {
            installationId,
            userId: authenticatedUserId,
            runtimeThreadId: threadId,
            runtimeTurnId,
            browserThreadId: chatRequest.threadId,
            permissions,
            approvalStore,
            signal: turnSignal,
            emitApproval: async (item) => {
              await emit(
                { type: "approval", item },
                { envelope, key: `approval:${item.status}:${item.id}` },
              );
            },
            execute: executeBrowserAgentCommand,
          }) as JsonValue;
        }
        const approval = approvalFromRequest(legacyServerRequest(request));
        if (!approval || approval.item.threadId !== threadId ||
            (runtimeTurnId && approval.item.turnId !== runtimeTurnId)) {
          throw new Error(`AiBrain encara no admet ${request.method}.`);
        }
        const permissionBoundItem = {
          ...approval.item,
          permissionFingerprint: permissions.fingerprint,
        };
        if (!permissionAllowsGenericToolExecution(permissions)) {
          await emit(
            { type: "approval", item: resolvedApproval(permissionBoundItem, "decline") },
            { envelope, key: `approval:policy-denied:${approval.item.id}` },
          );
          return approval.response("decline") as JsonValue;
        }
        const durableApproval = await approvalStore.createPending({
          locator: approvalLocatorFromItem(installationId, authenticatedUserId, permissionBoundItem),
          requestType: approval.requestType,
        });
        if (durableApproval.status === "pending") {
          await emit(
            { type: "approval", item: permissionBoundItem },
            { envelope, key: `approval:pending:${approval.item.id}` },
          );
        }
        const decision = await waitForApproval(
          approvalStore,
          permissionBoundItem,
          approval.requestType,
          turnSignal,
        );
        await emit(
          { type: "approval", item: resolvedApproval(permissionBoundItem, decision) },
          { envelope, key: `approval:resolved:${approval.item.id}` },
        );
        return approval.response(decision) as JsonValue;
      },
      onFailure: (error) => finishTurn({ status: "failed", error: error.message }),
    },
  );

  signal.addEventListener("abort", forwardExternalAbort, { once: true });
  if (signal.aborted) turnController.abort();
  const unregisterCancellation = registerWorkerTurnCancellation(
    authenticatedUserId,
    threadId,
    chatRequest.assistantMessageId,
    () => {
      remoteInterruptConfirmed = true;
      turnController.abort();
    },
  );

  const interrupt = () => {
    if (remoteInterruptConfirmed) {
      finishTurn({ status: "interrupted", error: null });
      return;
    }
    if (!runtimeTurnId) {
      finishTurn({ status: "failed", error: "El torn encara no tenia un identificador interrompible." });
      return;
    }
    void runtime.client.request(
      "turn/interrupt",
      { threadId, turnId: runtimeTurnId },
      `turn-interrupt:${chatRequest.assistantMessageId}`,
      5_000,
    ).catch((error: unknown) => finishTurn({
      status: "failed",
      error: error instanceof Error
        ? `No s’ha pogut confirmar la interrupció: ${error.message}`
        : "No s’ha pogut confirmar la interrupció.",
    }));
  };
  turnSignal.addEventListener("abort", interrupt, { once: true });
  if (turnSignal.aborted) interrupt();
  try {
    if (recoveredState?.status === "inProgress") {
      runtimeTurnId = recoveredState.id;
      registration.bindRuntimeTurn(recoveredState.id);
    } else {
      const turnResult = await runtime.client.request("turn/start", {
      threadId,
      clientUserMessageId: chatRequest.userMessageId,
      input: [
        { type: "text", text: chatRequest.message, text_elements: [] },
        ...turnDocumentCodexInputs(turnDocuments),
        ...(selectedSkill ? [{ type: "skill" as const, name: selectedSkill.id, path: selectedSkill.path }] : []),
        ...chatRequest.options.attachments.map((attachment) => ({
          type: "image" as const,
          url: attachment.dataUrl,
        })),
      ],
      cwd: projectWorkspace,
      runtimeWorkspaceRoots: [projectWorkspace],
      approvalPolicy: runtimeConfig.approvalPolicy,
      approvalsReviewer: "user",
      sandboxPolicy: sandboxPolicy({ ...runtimeConfig, workspace: projectWorkspace }, chatRequest),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(chatRequest.options.effort ? { effort: chatRequest.options.effort } : {}),
      }, `turn-start:${chatRequest.assistantMessageId}`, 60_000, async (result) => {
        const resolvedTurnId = extractTurnId(result);
        if (!resolvedTurnId) throw new Error("Codex no ha iniciat el torn.");
        runtimeTurnId = resolvedTurnId;
        registration.bindRuntimeTurn(resolvedTurnId);
        await emit({ type: "runtimeTurn", turnId: resolvedTurnId });
      }, maintenanceActivity);
      runtimeTurnId ??= extractTurnId(turnResult);
      if (!runtimeTurnId) throw new Error("Codex no ha iniciat el torn.");
      registration.bindRuntimeTurn(runtimeTurnId);
    }
    const completed = await turnFinished;
    if (completed.status === "failed") return;
    if (completed.status === "interrupted" || turnSignal.aborted) {
      if (!stoppedEmitted) await emit({ type: "stopped" });
      return;
    }
    const totalMs = Math.round(performance.now() - runtimeStartedAt);
    const firstTextMs = firstDeltaAt === null ? null : Math.round(firstDeltaAt - runtimeStartedAt);
    await upsertActivity({
      id: "runtime-performance",
      kind: "system",
      label: "Rendiment del torn",
      detail: `${firstTextMs === null ? "Sense text incremental" : `Primer text ${firstTextMs} ms`} · Total ${totalMs} ms · Worker calent`,
      status: "complete",
    });
    operationalLogger.info("codex.turn_metrics", {
      installationId,
      userId: authenticatedUserId,
      projectId: chatRequest.projectId,
      firstTextMs,
      totalMs,
    });
  } finally {
    turnSignal.removeEventListener("abort", interrupt);
    signal.removeEventListener("abort", forwardExternalAbort);
    unregisterCancellation();
    registration.dispose();
  }
  } finally {
    if (ownsMaintenanceActivity) maintenanceActivity.release();
  }
}
