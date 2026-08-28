import "server-only";

import type { ActivityItem, ChatStreamEvent, TurnControlRequest } from "@/lib/chat-contract";
import type { JsonValue } from "@/runtime/transport";
import {
  cancelWorkerTurnLocally,
  requestPendingWorkerTurnCancellation,
  workerAppServerForUser,
  type WorkerAppServerClient,
} from "@/runtime/worker-runtime-service";

export class TurnControlError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TurnControlError";
  }
}

type TurnControlIdentity = {
  installationId: string;
  userId: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
};

type PendingTurnControlIdentity = Omit<TurnControlIdentity, "runtimeTurnId" | "runtimeThreadId"> & {
  runtimeThreadId: string | null;
};

type PersistAccepted = (event: ChatStreamEvent) => void | Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function acceptedActivity(request: TurnControlRequest): ActivityItem {
  return request.action === "steer"
    ? {
        id: `steer:${request.clientRequestId}`,
        kind: "system",
        label: "Indicació afegida al torn",
        detail: "Codex ha acceptat la indicació durant l’execució.",
        status: "complete",
      }
    : {
        id: `stop:${request.clientRequestId}`,
        kind: "system",
        label: "Aturada confirmada",
        detail: "Codex ha confirmat la interrupció d’aquest torn.",
        status: "stopped",
      };
}

function assertSteerResponse(value: unknown, expectedTurnId: string) {
  if (!isRecord(value) || value.turnId !== expectedTurnId) {
    throw new TurnControlError(
      "TURN_CONTROL_RESPONSE_INVALID",
      "Codex ha retornat una resposta de steering inconsistent.",
    );
  }
}

async function persistAcceptedStop(
  request: Extract<TurnControlRequest, { action: "stop" }>,
  persistAccepted: PersistAccepted,
) {
  await persistAccepted({ type: "activity", item: acceptedActivity(request) });
  await persistAccepted({ type: "stopped" });
}

export async function cancelPendingWorkerTurn(
  identity: PendingTurnControlIdentity,
  request: Extract<TurnControlRequest, { action: "stop" }>,
  persistAccepted: PersistAccepted,
) {
  const activeRunnerCancelled = identity.runtimeThreadId
    ? cancelWorkerTurnLocally(
        identity.userId,
        identity.runtimeThreadId,
        request.assistantMessageId,
        false,
      )
    : false;
  const cancellationAccepted = activeRunnerCancelled || requestPendingWorkerTurnCancellation(
    identity.userId,
    request.assistantMessageId,
  );
  if (!cancellationAccepted) {
    throw new TurnControlError(
      "TURN_CONTROL_NOT_ACTIVE",
      "El worker encara no té un torn local que es pugui aturar.",
    );
  }
  await persistAcceptedStop(request, persistAccepted);
  return { action: request.action, runtimeTurnId: null, activeRunnerCancelled } as const;
}

export async function executeTurnControl(
  client: Pick<WorkerAppServerClient, "request">,
  identity: TurnControlIdentity,
  request: TurnControlRequest,
  persistAccepted: PersistAccepted,
) {
  const activity = acceptedActivity(request);
  if (request.action === "steer") {
    const result = await client.request("turn/steer", {
      threadId: identity.runtimeThreadId,
      expectedTurnId: identity.runtimeTurnId,
      clientUserMessageId: request.userMessageId,
      input: [{ type: "text", text: request.message.trim(), text_elements: [] }],
    }, `turn-steer:${request.clientRequestId}`, 30_000, async (value) => {
      assertSteerResponse(value, identity.runtimeTurnId);
      await persistAccepted({ type: "activity", item: activity });
    });
    assertSteerResponse(result, identity.runtimeTurnId);
    return { action: request.action, runtimeTurnId: identity.runtimeTurnId } as const;
  }

  await client.request("turn/interrupt", {
    threadId: identity.runtimeThreadId,
    turnId: identity.runtimeTurnId,
  }, `turn-interrupt:${request.clientRequestId}`, 10_000, async (_value: JsonValue) => {
    await persistAcceptedStop(request, persistAccepted);
  });
  const activeRunnerCancelled = cancelWorkerTurnLocally(
    identity.userId,
    identity.runtimeThreadId,
    request.assistantMessageId,
    true,
  );
  return {
    action: request.action,
    runtimeTurnId: identity.runtimeTurnId,
    activeRunnerCancelled,
  } as const;
}

export async function controlWorkerTurn(
  identity: TurnControlIdentity,
  request: TurnControlRequest,
  persistAccepted: PersistAccepted,
) {
  const runtime = await workerAppServerForUser(identity.userId);
  if (runtime.config.installationId !== identity.installationId) {
    throw new TurnControlError(
      "TURN_CONTROL_INSTALLATION_MISMATCH",
      "La instal·lació del worker no coincideix amb la sessió.",
    );
  }
  return executeTurnControl(runtime.client, identity, request, persistAccepted);
}
