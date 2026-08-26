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
import {
  runCodexTurn,
  type CodexTurnEvent,
} from "@/runtime/codex-app-server";
import { readThreadToken } from "@/runtime/thread-token";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import { workbenchErrorResponse } from "@/workbench/http";
import {
  beginThreadTurn,
  finishThreadTurn,
  getThreadRuntimeContext,
  isBrowserPreviewWorkbench,
} from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";
const encoder = new TextEncoder();

function line(event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
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
  };
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
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

  const browserPreview = isBrowserPreviewWorkbench();
  let persistent = !browserPreview;
  let context: {
    projectId: string;
    projectName: string;
    workspaceKey: string;
    runtimeThreadToken: string | null;
  };
  try {
    context = await getThreadRuntimeContext(session, body.threadId);
  } catch (error) {
    if (!browserPreview || !(error instanceof WorkbenchNotFoundError)) {
      return workbenchErrorResponse(error, "No s’ha pogut resoldre el fil persistent.");
    }
    persistent = false;
    context = {
      projectId: body.projectId,
      projectName: "Preview local",
      workspaceKey: "workspace",
      runtimeThreadToken: null,
    };
  }
  if (context.projectId !== body.projectId) {
    return NextResponse.json({ error: "El fil no pertany a aquest projecte." }, { status: 403 });
  }

  const config = readRuntimeConfig(session.tenant.id, context.workspaceKey);
  const runtimeThreadId = context.runtimeThreadToken
    ? readThreadToken(context.runtimeThreadToken, session.tenant.id)
    : null;
  if (context.runtimeThreadToken && !runtimeThreadId) {
    return NextResponse.json(
      { error: "La represa privada del fil ha caducat o no és vàlida." },
      { status: 409 },
    );
  }

  const startedAt = new Date();
  const userMessage = message(
    body.userMessageId,
    "user",
    body.message.trim(),
    "complete",
    startedAt.toISOString(),
  );
  userMessage.attachments = body.options.attachments.map(({ dataUrl: _dataUrl, ...attachment }) => attachment);
  let assistantMessage = message(
    body.assistantMessageId,
    "assistant",
    "",
    "streaming",
    new Date(startedAt.getTime() + 1).toISOString(),
  );
  if (persistent) {
    try {
      await beginThreadTurn(session, body.threadId, userMessage, assistantMessage);
    } catch (error) {
      return workbenchErrorResponse(error, "No s’ha pogut iniciar el torn persistent.");
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let runtimeThreadToken: string | null = null;
      const emit = (event: ChatStreamEvent) => {
        assistantMessage = applyChatStreamEvent(assistantMessage, event);
        controller.enqueue(line(event));
      };
      const emitCodex = (event: CodexTurnEvent) => {
        if (event.type === "runtimeThread") {
          runtimeThreadToken = event.threadToken;
          return;
        }
        emit(event);
      };

      try {
        if (config.mode === "codex") {
          await runCodexTurn(
            body,
            session.tenant.id,
            runtimeThreadId,
            config,
            request.signal,
            emitCodex,
          );
        } else {
          emit({ type: "plan", explanation: "Previsualització demo", steps: buildDemoPlan() });
          for (const activity of buildDemoActivities(body.preferences.showActivity)) {
            if (request.signal.aborted) break;
            emit({ type: "activity", item: activity });
            await delay(110, request.signal);
          }
          if (!request.signal.aborted) emit({ type: "diff", value: buildDemoDiff() });
          for (const word of buildDemoAnswer(body).split(/(?<=\s)/)) {
            if (request.signal.aborted) break;
            emit({ type: "delta", value: word });
            await delay(14, request.signal);
          }
          if (!request.signal.aborted) emit({ type: "done" });
        }
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "El runtime no està disponible.",
        });
      } finally {
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
            console.error("AiBrain thread persistence failed", error);
            if (!request.signal.aborted) {
              emit({ type: "error", message: "El torn ha acabat, però no s’ha pogut persistir." });
            }
          }
        }
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
