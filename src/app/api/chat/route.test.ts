import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocked = vi.hoisted(() => {
  class WorkerTurnRecoveryPendingError extends Error {}
  return {
    releaseMaintenance: vi.fn(),
    runWorkerCodexTurn: vi.fn(),
    persistProjection: vi.fn(async () => undefined),
    WorkerTurnRecoveryPendingError,
  };
});

vi.mock("@/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(async () => true),
}));

vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({
    tenant: { id: "qa-company" },
    user: { id: "00000000-0000-4000-8000-000000000001" },
  })),
}));

vi.mock("@/runtime/config", () => ({
  readRuntimeConfig: vi.fn(() => ({
    tenantId: "qa-company",
    mode: "codex",
    codexBinary: "codex",
    codexHome: null,
    workspace: "/unused",
    model: null,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  })),
}));

vi.mock("@/config/installation", () => ({
  loadInstallationConfig: vi.fn(async () => ({
    installationId: "qa-company",
    branding: { productName: "AiBrain" },
    paths: { usersRoot: "/tmp/aibrain-route-test/users" },
  })),
}));

vi.mock("@/runtime/worker-codex-turn", () => ({
  runWorkerCodexTurn: mocked.runWorkerCodexTurn,
  WorkerTurnRecoveryPendingError: mocked.WorkerTurnRecoveryPendingError,
}));

vi.mock("@/runtime/permission-turn", () => ({
  resolveServerTurnPermissions: vi.fn(async () => ({ fingerprint: "a".repeat(64) })),
}));

vi.mock("@/runtime/approval-store", () => ({
  FileApprovalStore: class FileApprovalStore {},
}));

vi.mock("@/runtime/thread-token", () => ({
  CURRENT_THREAD_TOOLSET_REVISION: "aibrain-tools-test",
  readThreadTokenContext: vi.fn(() => null),
}));

vi.mock("@/workbench/store", () => ({
  beginThreadTurn: vi.fn(),
  finishThreadTurn: vi.fn(),
  getThreadRuntimeContext: vi.fn(),
  isBrowserPreviewWorkbench: vi.fn(() => true),
  prepareThreadTurn: vi.fn(),
}));

vi.mock("@/workbench/http", () => ({
  workbenchErrorResponse: vi.fn(() => new Response(null, { status: 500 })),
}));

vi.mock("@/workbench/turn-projection-store", () => ({
  FileTurnProjectionStore: class FileTurnProjectionStore {
    private message: unknown;
    async initialize(_thread: string, message: unknown) { this.message = message; return { message }; }
    async applyTransportEvents() { await mocked.persistProjection(); return { message: this.message }; }
  },
}));

vi.mock("@/runtime/worker-runtime-service", () => ({
  acquireWorkerTurnActivity: vi.fn(async () => ({ release: mocked.releaseMaintenance })),
  workerTurnIsActive: vi.fn(() => false),
}));

vi.mock("@/memory", () => ({
  LocalFileMemoryService: class LocalFileMemoryService {},
}));

vi.mock("@/runtime/memory-turn", () => ({
  FileMemoryTurnAuditSink: class FileMemoryTurnAuditSink {},
}));

vi.mock("@/documents/server-service", () => ({
  documentServicesForUser: vi.fn(),
}));

vi.mock("@/documents/turn-attachments", () => ({
  resolveTurnDocumentAttachments: vi.fn(),
  ServerTurnDocumentInputResolver: class ServerTurnDocumentInputResolver {},
  TurnDocumentAttachmentError: class TurnDocumentAttachmentError extends Error {},
  turnDocumentChatAttachments: vi.fn(() => []),
}));

vi.mock("@/operations/server-logger", () => ({
  operationalLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/operations/maintenance", () => ({
  MaintenanceModeError: class MaintenanceModeError extends Error {},
}));

vi.mock("@/usage/server-service", () => ({
  recordTurnUsage: vi.fn(async () => undefined),
}));

vi.mock("@/settings/server-service", () => ({
  featurePolicyForUser: vi.fn(async () => ({
    "web-search": true,
    "image-generation": true,
    skills: true,
  })),
}));

import { POST, runtimeThreadIdForChatMessage } from "@/app/api/chat/route";
import { isBrowserPreviewWorkbench, prepareThreadTurn } from "@/workbench/store";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function chatRequest(signal: AbortSignal, optionOverrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "00000000-0000-4000-8000-000000000011",
      threadId: "00000000-0000-4000-8000-000000000012",
      userMessageId: "00000000-0000-4000-8000-000000000013",
      assistantMessageId: "00000000-0000-4000-8000-000000000014",
      message: "Continue after reconnect",
      preferences: { tone: "direct", language: "en", showActivity: true },
      options: {
        mode: "agent",
        experience: "smart",
        model: null,
        effort: null,
        webSearch: false,
        imageGeneration: false,
        skill: null,
        attachments: [],
        ...optionOverrides,
      },
    }),
  });
}

describe("chat turn transport lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams a 64-event burst while the durable projection write is stalled", async () => {
    const persistence = deferred();
    const completion = deferred();
    vi.mocked(isBrowserPreviewWorkbench).mockReturnValueOnce(false);
    vi.mocked(prepareThreadTurn).mockResolvedValueOnce({
      context: { projectId: "00000000-0000-4000-8000-000000000011", projectName: "Test",
        workspaceKey: "workspace", projectInstructions: "", projectMemory: "", projectSources: [],
        visibleProjects: [], runtimeThreadToken: null, branchHistory: null },
      begin: async (_user: unknown, assistantMessage: unknown) => ({ outcome: "created", assistantMessage }),
    } as never);
    mocked.persistProjection.mockImplementationOnce(() => persistence.promise);
    mocked.runWorkerCodexTurn.mockImplementation(async (...args: unknown[]) => {
      const emit = args[10] as (event: unknown, projection: unknown) => Promise<void>;
      for (let index = 1; index <= 64; index += 1) await emit({ type: "delta", value: `${index} ` }, {
        envelope: { eventId: `burst-${index}`, sequence: index, occurredAt: new Date().toISOString(),
          message: { kind: "rpc-notification", rpc: {} } }, key: `delta:${index}`,
      });
      await completion.promise;
      await emit({ type: "done" }, { envelope: { eventId: "burst-65", sequence: 65,
        occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } }, key: "done" });
    });
    const response = await POST(chatRequest(new AbortController().signal));
    const reader = response.body!.getReader();
    try {
      const received: string[] = [];
      for (let index = 1; index <= 64; index += 1) {
        const chunk = await reader.read();
        received.push(JSON.parse(new TextDecoder().decode(chunk.value)).value);
      }
      expect(received).toEqual(Array.from({ length: 64 }, (_, index) => `${index + 1} `));
      expect(mocked.persistProjection).toHaveBeenCalledOnce();
    } finally {
      persistence.resolve();
      completion.resolve();
      await reader.cancel();
    }
    await vi.waitFor(() => expect(mocked.releaseMaintenance).toHaveBeenCalledOnce());
  });

  it("re-bootstraps only automation turns from a legacy dynamic-tool thread", () => {
    const legacy = { threadId: "runtime-thread-legacy", toolsetRevision: null };
    const current = { threadId: "runtime-thread-current", toolsetRevision: "aibrain-tools-test" };
    expect(runtimeThreadIdForChatMessage(legacy, "Envíame hello dentro de 2 minutos")).toBeNull();
    expect(runtimeThreadIdForChatMessage(legacy, "Resume la conversación")).toBe("runtime-thread-legacy");
    expect(runtimeThreadIdForChatMessage(current, "Cada lunes prepara un resumen")).toBe("runtime-thread-current");
  });

  it("rejects browser-supplied provider settings", async () => {
    const response = await POST(chatRequest(new AbortController().signal, {
      model: "gpt-5.6-sol",
      effort: "high",
    }));
    expect(response.status).toBe(400);
    expect(mocked.runWorkerCodexTurn).not.toHaveBeenCalled();
  });

  it("keeps the server-owned turn alive when the NDJSON client disconnects", async () => {
    const turnGate = deferred();
    let captureWorkerSignal!: (signal: AbortSignal) => void;
    const workerSignal = new Promise<AbortSignal>((resolve) => {
      captureWorkerSignal = resolve;
    });
    mocked.runWorkerCodexTurn.mockImplementation(async (...args: unknown[]) => {
      captureWorkerSignal(args[9] as AbortSignal);
      const emit = args[10] as (event: Record<string, unknown>) => Promise<void>;
      await turnGate.promise;
      await emit({ type: "runtimeTurn", turnId: "runtime-turn-1" });
      await emit({ type: "delta", value: "still running" });
      await emit({ type: "done" });
    });

    const client = new AbortController();
    const response = await POST(chatRequest(client.signal));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const signal = await workerSignal;

    client.abort();
    expect(signal.aborted).toBe(false);
    turnGate.resolve();

    await vi.waitFor(() => expect(mocked.releaseMaintenance).toHaveBeenCalledOnce());
    expect(signal.aborted).toBe(false);
  });

  it("keeps a quiet long-running response alive with a durable snapshot", async () => {
    vi.useFakeTimers();
    try {
      const turnGate = deferred();
      mocked.runWorkerCodexTurn.mockImplementation(async () => {
        await turnGate.promise;
      });

      const response = await POST(chatRequest(new AbortController().signal));
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const nextChunk = reader!.read();

      await vi.advanceTimersByTimeAsync(15_000);
      const chunk = await nextChunk;
      expect(chunk.done).toBe(false);
      const event = JSON.parse(new TextDecoder().decode(chunk.value));
      expect(event).toMatchObject({
        type: "snapshot",
        message: { status: "streaming" },
      });

      await reader!.cancel();
      turnGate.resolve();
      await vi.waitFor(() => expect(mocked.releaseMaintenance).toHaveBeenCalledOnce());
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invent a terminal error when the remote turn needs reconciliation", async () => {
    mocked.runWorkerCodexTurn.mockRejectedValueOnce(
      new mocked.WorkerTurnRecoveryPendingError("event stream disconnected"),
    );

    const response = await POST(chatRequest(new AbortController().signal));
    const events = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
    expect(mocked.releaseMaintenance).toHaveBeenCalledOnce();
  });

  it("adds transport order and a measured duration before streaming terminal events", async () => {
    mocked.runWorkerCodexTurn.mockImplementation(async (...args: unknown[]) => {
      const emit = args[10] as (
        event: Record<string, unknown>,
        projection?: Record<string, unknown>,
      ) => Promise<void>;
      await emit({
        type: "activity",
        item: { id: "summary-ordered", kind: "reasoning", label: "Resumen público", status: "complete" },
      }, {
        envelope: {
          eventId: "event-42",
          sequence: 42,
          occurredAt: "2026-08-30T10:00:00.000Z",
          message: { kind: "rpc-notification", rpc: { method: "item/completed", params: {} } },
        },
        key: "activity:summary-ordered",
      });
      await emit({ type: "done" });
    });

    const response = await POST(chatRequest(new AbortController().signal));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ id: "summary-ordered", sequence: 42 }),
    }));
    const done = events.find((event) => event.type === "done");
    expect(done).toEqual(expect.objectContaining({
      type: "done",
      durationMs: expect.any(Number),
    }));
    expect(Number.isSafeInteger(done.durationMs)).toBe(true);
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
    expect(done.durationMs).toBeLessThan(10_000);
  });
});
