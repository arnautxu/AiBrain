import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  releaseMaintenance: vi.fn(),
  runWorkerCodexTurn: vi.fn(),
}));

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
}));

vi.mock("@/runtime/permission-turn", () => ({
  resolveServerTurnPermissions: vi.fn(async () => ({ fingerprint: "a".repeat(64) })),
}));

vi.mock("@/runtime/approval-store", () => ({
  FileApprovalStore: class FileApprovalStore {},
}));

vi.mock("@/runtime/thread-token", () => ({
  readThreadToken: vi.fn(() => null),
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
  FileTurnProjectionStore: class FileTurnProjectionStore {},
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
  recordTurnUsage: vi.fn(),
}));

vi.mock("@/settings/server-service", () => ({
  featurePolicyForUser: vi.fn(async () => ({
    "web-search": true,
    "image-generation": true,
    skills: true,
  })),
}));

import { POST } from "@/app/api/chat/route";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function chatRequest(signal: AbortSignal) {
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
        model: null,
        effort: null,
        webSearch: false,
        imageGeneration: false,
        skill: null,
        attachments: [],
      },
    }),
  });
}

describe("chat turn transport lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(events).toContainEqual(expect.objectContaining({
      type: "done",
      durationMs: expect.any(Number),
    }));
  });
});
