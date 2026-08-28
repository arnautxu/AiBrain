import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import {
  applyChatStreamEvent,
  type ChatMessage,
  type ChatStreamEvent,
} from "@/lib/chat-contract";
import {
  buildDemoActivities,
  buildDemoAnswer,
  buildDemoDiff,
  buildDemoPlan,
  isChatRequest,
} from "@/lib/demo-runtime";
import { readRuntimeConfig } from "@/runtime/config";
import { loadInstallationConfig } from "@/config/installation";
import {
  runWorkerCodexTurn,
  type WorkerCodexTurnEvent,
  type WorkerTurnProjection,
} from "@/runtime/worker-codex-turn";
import { resolveServerTurnPermissions } from "@/runtime/permission-turn";
import type { ResolvedPermissions } from "@/permissions";
import { FileApprovalStore } from "@/runtime/approval-store";
import { readThreadToken } from "@/runtime/thread-token";
import { workbenchErrorResponse } from "@/workbench/http";
import {
  beginThreadTurn,
  finishThreadTurn,
  getThreadRuntimeContext,
  isBrowserPreviewWorkbench,
} from "@/workbench/store";
import { isUuid } from "@/workbench/types";
import { FileTurnProjectionStore } from "@/workbench/turn-projection-store";
import type { TurnProjectionTransportEvent } from "@/workbench/turn-projection-store";
import {
  acquireWorkerTurnActivity,
  workerTurnIsActive,
} from "@/runtime/worker-runtime-service";
import { LocalFileMemoryService } from "@/memory";
import {
  FileMemoryTurnAuditSink,
  type WorkerTurnMemoryDependencies,
} from "@/runtime/memory-turn";
import { documentServicesForUser } from "@/documents/server-service";
import {
  resolveTurnDocumentAttachments,
  ServerTurnDocumentInputResolver,
  TurnDocumentAttachmentError,
  turnDocumentChatAttachments,
  type ResolvedTurnDocument,
} from "@/documents/turn-attachments";
import { operationalLogger } from "@/operations/server-logger";
import {
  MaintenanceModeError,
  type MaintenanceActivityLease,
} from "@/operations/maintenance";
import { recordTurnUsage } from "@/usage/server-service";
import type { TokenUsageBreakdown } from "@/usage/contracts";
import { featurePolicyForUser } from "@/settings/server-service";

export const runtime = "nodejs";
const encoder = new TextEncoder();
const PROJECTION_BATCH_DELAY_MS = 24;
const PROJECTION_BATCH_MAX_EVENTS = 64;

function line(event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

class TurnProjectionBatchWriter {
  private pending: TurnProjectionTransportEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain = Promise.resolve();
  private failure: unknown = null;

  constructor(
    private readonly store: FileTurnProjectionStore,
    private readonly threadId: string,
    private readonly assistantMessageId: string,
  ) {}

  enqueue(event: TurnProjectionTransportEvent) {
    if (this.failure) return;
    this.pending.push(event);
    if (this.pending.length >= PROJECTION_BATCH_MAX_EVENTS) {
      void this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, PROJECTION_BATCH_DELAY_MS);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending.splice(0);
    if (batch.length > 0) {
      this.chain = this.chain.then(async () => {
        if (this.failure) return;
        await this.store.applyTransportEvents(
          this.threadId,
          this.assistantMessageId,
          batch,
        );
      }).catch((error: unknown) => {
        this.failure ??= error;
      });
    }
    await this.chain;
    if (this.failure) throw this.failure;
  }
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
  status: ChatMessage["status"],
  createdAt: string,
): ChatMessage {
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

function replayHeaders() {
  return {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-AiBrain-Idempotent-Replay": "true",
  };
}

function replayMessageResponse(messageToReplay: ChatMessage) {
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(line({ type: "snapshot", message: messageToReplay }));
      controller.close();
    },
  });
  return new Response(replay, { headers: replayHeaders() });
}

function followProjectedTurn(
  store: FileTurnProjectionStore,
  threadId: string,
  assistantMessageId: string,
  initial: ChatMessage,
  signal: AbortSignal,
) {
  const replay = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastUpdatedAt = "";
      let current = initial;
      controller.enqueue(line({ type: "snapshot", message: current }));
      const deadline = Date.now() + 10 * 60_000;
      while (!signal.aborted && current.status === "streaming" && Date.now() < deadline) {
        await delay(100, signal);
        const projection = await store.read(threadId, assistantMessageId);
        if (!projection) break;
        current = projection.message;
        if (projection.updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = projection.updatedAt;
          controller.enqueue(line({ type: "snapshot", message: current }));
        }
      }
      controller.close();
    },
  });
  return new Response(replay, { headers: replayHeaders() });
}

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isChatRequest(body) || !body.message.trim() ||
    !isUuid(body.projectId) || !isUuid(body.threadId) ||
    !isUuid(body.userMessageId) || !isUuid(body.assistantMessageId)) {
    return NextResponse.json({ error: "La petició de xat no és vàlida." }, { status: 400 });
  }

  try {
    const featurePolicy = await featurePolicyForUser(session);
    const disabledFeature = body.options.webSearch && !featurePolicy["web-search"]
      ? "búsqueda web"
      : body.options.imageGeneration && !featurePolicy["image-generation"]
        ? "generación de imágenes"
        : body.options.skill && !featurePolicy.skills ? "skills" : null;
    if (disabledFeature) {
      return NextResponse.json({
        error: `La capacidad ${disabledFeature} está desactivada en Configuración.`,
        code: "FEATURE_DISABLED",
      }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }
  } catch {
    return NextResponse.json({
      error: "No se ha podido verificar la política de aplicaciones.",
      code: "FEATURE_POLICY_UNAVAILABLE",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }

  const browserPreview = isBrowserPreviewWorkbench();
  let persistent = !browserPreview;
  let context: {
    projectId: string;
    projectName: string;
    workspaceKey: string;
    projectInstructions: string;
    projectMemory: string;
    projectSources: { kind: "file" | "link" | "note"; name: string; url: string | null; excerpt: string | null; status: "ready" | "pending-index" }[];
    runtimeThreadToken: string | null;
    branchHistory: string | null;
  };
  if (browserPreview) {
    persistent = false;
    context = {
      projectId: body.projectId,
      projectName: "Preview local",
      workspaceKey: "workspace",
      projectInstructions: "",
      projectMemory: "",
      projectSources: [],
      runtimeThreadToken: null,
      branchHistory: null,
    };
  } else {
    try {
      context = await getThreadRuntimeContext(session, body.threadId);
    } catch (error) {
      return workbenchErrorResponse(error, "No s’ha pogut resoldre el fil persistent.");
    }
  }
  if (context.projectId !== body.projectId) {
    return NextResponse.json({ error: "El fil no pertany a aquest projecte." }, { status: 403 });
  }

  const config = readRuntimeConfig(session.tenant.id, context.workspaceKey);
  const runtimeThreadId = context.runtimeThreadToken
    ? readThreadToken(context.runtimeThreadToken, session.tenant.id, session.user.id)
    : null;
  if (context.runtimeThreadToken && !runtimeThreadId) {
    return NextResponse.json(
      { error: "La represa privada del fil ha caducat o no és vàlida." },
      { status: 409 },
    );
  }

  let maintenanceActivity: MaintenanceActivityLease | null = null;
  if (config.mode === "codex") {
    try {
      maintenanceActivity = await acquireWorkerTurnActivity();
    } catch (error) {
      if (error instanceof MaintenanceModeError) {
        return NextResponse.json(
          {
            error: "El servei està en manteniment. Torna-ho a provar més tard.",
            code: error.code,
            retryAfterMs: error.retryAfterMs,
          },
          {
            status: 503,
            headers: {
              "Cache-Control": "private, no-store",
              "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))),
            },
          },
        );
      }
      return NextResponse.json(
        { error: "No s’ha pogut verificar l’estat operatiu.", code: "MAINTENANCE_CHECK_FAILED" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }

  let turnPermissions: ResolvedPermissions | null = null;
  let approvalStore: FileApprovalStore | null = null;
  let turnProjectionStore: FileTurnProjectionStore | null = null;
  let turnMemory: WorkerTurnMemoryDependencies | null = null;
  let turnDocuments: readonly ResolvedTurnDocument[] = [];
  let assistantName = "AiBrain";
  if (config.mode === "codex") {
    try {
      const installation = await loadInstallationConfig();
      assistantName = installation.branding.productName;
      turnPermissions = await resolveServerTurnPermissions(installation, {
        installationId: session.tenant.id,
        userId: session.user.id,
        projectId: context.projectId,
        turnId: body.assistantMessageId,
      });
      approvalStore = new FileApprovalStore({
        installationId: installation.installationId,
        userId: session.user.id,
        usersRoot: installation.paths.usersRoot,
      });
      turnProjectionStore = new FileTurnProjectionStore({
        installationId: installation.installationId,
        userId: session.user.id,
        usersRoot: installation.paths.usersRoot,
      });
      turnMemory = {
        memoryService: new LocalFileMemoryService({ config: installation }),
        auditSink: new FileMemoryTurnAuditSink({
          installationId: installation.installationId,
          userId: session.user.id,
          usersRoot: installation.paths.usersRoot,
        }),
      };
      const documentUploadIds = body.options.documentUploadIds ?? [];
      if (documentUploadIds.length > 0) {
        const documentServices = await documentServicesForUser(installation, session.user.id);
        turnDocuments = await resolveTurnDocumentAttachments({
          staging: documentServices.staging,
          threadId: body.threadId,
          uploadIds: documentUploadIds,
          permissions: turnPermissions,
          signal: request.signal,
          inputResolver: new ServerTurnDocumentInputResolver({
            stagingRoot: documentServices.manifest.roots.staging,
            previews: documentServices.previews,
            pdftotext: documentServices.toolchain.pdftotext,
            conversionGate: documentServices.conversionGate,
          }),
        });
      }
    } catch (error) {
      maintenanceActivity?.release();
      if (error instanceof TurnDocumentAttachmentError) {
        return NextResponse.json(
          { error: error.code === "TURN_DOCUMENT_PERMISSION_DENIED"
            ? "La política del torn no permet consultar aquests documents."
            : "Els adjunts documentals del torn no són vàlids." },
          { status: error.code === "TURN_DOCUMENT_PERMISSION_DENIED" ? 403 : 400 },
        );
      }
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "PERMISSION_PREFLIGHT_FAILED";
      operationalLogger.warn("permissions.preflight_rejected", { code });
      if (code === "DOCUMENT_CONVERSION_BACKPRESSURE") {
        const retryAfterMs = error && typeof error === "object" && "retryAfterMs" in error &&
          typeof error.retryAfterMs === "number" ? error.retryAfterMs : 1_000;
        return NextResponse.json(
          { error: "La conversió de documents està ocupada. Torna-ho a provar." },
          {
            status: 429,
            headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) },
          },
        );
      }
      return NextResponse.json(
        { error: "No s’ha pogut verificar la política d’aquest torn." },
        { status: 503 },
      );
    }
  }

  const startedAt = new Date();
  const userMessage = message(
    body.userMessageId,
    "user",
    body.displayMessage?.trim() || body.message.trim(),
    "complete",
    startedAt.toISOString(),
  );
  userMessage.attachments = body.options.attachments.map(({ dataUrl: _dataUrl, ...attachment }) => attachment);
  userMessage.attachments.push(...turnDocumentChatAttachments(turnDocuments));
  let assistantMessage = message(
    body.assistantMessageId,
    "assistant",
    "",
    "streaming",
    new Date(startedAt.getTime() + 1).toISOString(),
  );
  assistantMessage.sources = userMessage.attachments.map((attachment) => ({
    id: `source-file-${attachment.id}`,
    kind: "file",
    title: attachment.name.replace(/\p{C}+/gu, " ").trim() || "Archivo adjunto",
    url: null,
    domain: null,
    snippet: null,
    publishedAt: null,
  }));
  let turnOutcome: "created" | "existing" = "created";
  if (persistent) {
    try {
      const begun = await beginThreadTurn(session, body.threadId, userMessage, assistantMessage);
      turnOutcome = begun.outcome;
      assistantMessage = begun.assistantMessage;
    } catch (error) {
      maintenanceActivity?.release();
      return workbenchErrorResponse(error, "No s’ha pogut iniciar el torn persistent.");
    }
  }
  if (persistent && config.mode === "codex" && turnProjectionStore) {
    try {
      assistantMessage = (await turnProjectionStore.initialize(body.threadId, assistantMessage)).message;
    } catch (error) {
      maintenanceActivity?.release();
      assistantMessage = {
        ...assistantMessage,
        status: "error",
        content: "No s’ha pogut preparar la recuperació durable del torn.",
      };
      await finishThreadTurn(session, body.threadId, assistantMessage, null).catch(() => undefined);
      return workbenchErrorResponse(error, "No s’ha pogut preparar la recuperació durable del torn.");
    }
  }
  if (turnOutcome === "existing") {
    if (assistantMessage.status !== "streaming" || !turnProjectionStore) {
      maintenanceActivity?.release();
      return replayMessageResponse(assistantMessage);
    }
    if (runtimeThreadId && workerTurnIsActive(
      session.user.id,
      runtimeThreadId,
      body.assistantMessageId,
    )) {
      maintenanceActivity?.release();
      return followProjectedTurn(
        turnProjectionStore,
        body.threadId,
        body.assistantMessageId,
        assistantMessage,
        request.signal,
      );
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let runtimeThreadToken: string | null = null;
      let runtimeTurnId: string | null = null;
      let firstTextAt: number | null = null;
      let tokenUsage: TokenUsageBreakdown | null = null;
      const projectionWriter = persistent && turnProjectionStore
        ? new TurnProjectionBatchWriter(
            turnProjectionStore,
            body.threadId,
            body.assistantMessageId,
          )
        : null;
      const emit = async (event: ChatStreamEvent, projection?: WorkerTurnProjection) => {
        if (persistent && turnProjectionStore && projectionWriter) {
          if (projection) {
            // Deliver the live App Server delta immediately. The durable
            // transport journal already owns replay; compact the refresh
            // projection in short atomic batches instead of blocking every
            // token on a full filesystem write.
            assistantMessage = applyChatStreamEvent(assistantMessage, event);
            projectionWriter.enqueue({
              envelope: projection.envelope,
              projectionKey: projection.key,
              event,
            });
          } else {
            await projectionWriter.flush();
            assistantMessage = (await turnProjectionStore.applyLocalEvent(
              body.threadId,
              body.assistantMessageId,
              event,
            )).message;
          }
        } else {
          assistantMessage = applyChatStreamEvent(assistantMessage, event);
        }
        controller.enqueue(line(event));
      };
      const emitCodex = async (event: WorkerCodexTurnEvent, projection?: WorkerTurnProjection) => {
        if (event.type === "runtimeThread") {
          runtimeThreadToken = event.threadToken;
          if (persistent && turnProjectionStore) {
            await turnProjectionStore.setRuntimeThreadToken(
              body.threadId,
              body.assistantMessageId,
              event.threadToken,
            );
          }
          return;
        }
        if (event.type === "runtimeTurn") {
          runtimeTurnId = event.turnId;
          if (persistent && turnProjectionStore) {
            await turnProjectionStore.setRuntimeTurnId(
              body.threadId,
              body.assistantMessageId,
              event.turnId,
            );
          }
          return;
        }
        if (event.type === "runtimeUsage") {
          tokenUsage = event.tokenUsage;
          return;
        }
        if (event.type === "delta") firstTextAt ??= Date.now();
        await emit(event, projection);
      };

      try {
        if (config.mode === "codex") {
          if (!turnPermissions || !approvalStore || !turnMemory) {
            throw new Error("La política, la memòria o les aprovacions del torn no estan disponibles.");
          }
          await runWorkerCodexTurn(
            body,
            session.tenant.id,
            session.user.id,
            runtimeThreadId,
            config,
            turnPermissions,
            approvalStore,
            turnMemory,
            turnDocuments,
            request.signal,
            emitCodex,
            maintenanceActivity ?? undefined,
            assistantName,
            context,
          );
        } else {
          await emit({ type: "plan", explanation: "Previsualització demo", steps: buildDemoPlan() });
          for (const activity of buildDemoActivities(body.preferences.showActivity)) {
            if (request.signal.aborted) break;
            await emit({ type: "activity", item: { ...activity, status: "running" } });
            await delay(600, request.signal);
            if (request.signal.aborted) break;
            await emit({ type: "activity", item: activity });
            await delay(60, request.signal);
          }
          if (!request.signal.aborted) await emit({ type: "diff", value: buildDemoDiff() });
          for (const word of buildDemoAnswer(body).split(/(?<=\s)/)) {
            if (request.signal.aborted) break;
            await emit({ type: "delta", value: word });
            await delay(14, request.signal);
          }
          if (!request.signal.aborted) await emit({ type: "done" });
        }
      } catch (error) {
        await emit({
          type: "error",
          message: error instanceof Error ? error.message : "El runtime no està disponible.",
        });
      } finally {
        try {
          await projectionWriter?.flush();
        } catch (error) {
          operationalLogger.error("turn.projection_flush_failed", { error });
          if (!request.signal.aborted) {
            const event: ChatStreamEvent = {
              type: "error",
              message: "El torn ha acabat, però no s’ha pogut consolidar la recuperació.",
            };
            assistantMessage = applyChatStreamEvent(assistantMessage, event);
            controller.enqueue(line(event));
          }
        }
        if (assistantMessage.status === "streaming") {
          assistantMessage = {
            ...assistantMessage,
            status: request.signal.aborted ? "stopped" : "error",
          };
        }
        if (persistent) {
          try {
            await finishThreadTurn(
              session,
              body.threadId,
              assistantMessage,
              runtimeThreadToken,
            );
          } catch (error) {
            operationalLogger.error("thread.persistence_failed", { error });
            if (!request.signal.aborted) {
              await emit({ type: "error", message: "El torn ha acabat, però no s’ha pogut persistir." });
            }
          }
        }
        if (persistent && config.mode === "codex" && turnOutcome === "created") {
          const completedAt = new Date();
          const status = assistantMessage.status === "complete"
            ? "completed"
            : assistantMessage.status === "stopped" ? "stopped" : "error";
          await recordTurnUsage({
            installationId: session.tenant.id,
            userId: session.user.id,
            projectId: body.projectId,
            threadId: body.threadId,
            turnId: runtimeTurnId ?? body.assistantMessageId,
            status,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
            firstTextMs: firstTextAt === null ? null : Math.max(0, firstTextAt - startedAt.getTime()),
            tokenUsage,
          }).catch((error: unknown) => {
            operationalLogger.error("usage.turn_record_failed", { error });
          });
        }
        maintenanceActivity?.release();
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
