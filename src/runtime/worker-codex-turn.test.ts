import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "@/lib/chat-contract";
import type { MemoryService } from "@/memory";
import type { ResolvedPermissions } from "@/permissions";
import type {
  MemoryTurnAuditEvent,
  WorkerTurnMemoryDependencies,
} from "@/runtime/memory-turn";
import { AppServerRequestTimeoutError } from "@/runtime/transport/app-server-rpc-router";

const mocked = vi.hoisted(() => ({
  runtime: null as unknown,
  maintenanceReleases: 0,
  maintenanceLease: null as unknown,
  cancelTurn: null as ((remoteInterruptConfirmed: boolean) => void) | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));
vi.mock("@/runtime/thread-token", () => ({
  CURRENT_THREAD_TOOLSET_REVISION: "test-current-toolset",
  issueThreadToken: () => "user-bound-runtime-thread-token",
  toolsetRevisionForIssuedThreadToken: (threadId: string | null, revision: string | null) => threadId ? revision : "test-current-toolset",
}));
vi.mock("@/runtime/worker-runtime-service", () => ({
  acquireWorkerTurnActivity: async () => {
    const lease = {
      activityId: "00000000-0000-4000-8000-000000000099",
      kind: "turn",
      acquiredAt: "2026-08-27T00:00:00.000Z",
      release: () => { mocked.maintenanceReleases += 1; },
    };
    mocked.maintenanceLease = lease;
    return lease;
  },
  workerAppServerForUser: async (_userId: string, lease: unknown) => {
    if (lease !== mocked.maintenanceLease) throw new Error("Worker activity lease was not forwarded.");
    return mocked.runtime;
  },
  registerWorkerTurnCancellation: (
    _userId: string,
    _runtimeThreadId: string,
    _localTurnId: string,
    cancel: (remoteInterruptConfirmed: boolean) => void,
  ) => {
    mocked.cancelTurn = cancel;
    return () => { mocked.cancelTurn = null; };
  },
}));

import {
  documentToolTerminalGraceMs,
  runWorkerCodexTurn,
  workerTurnTimeoutMs,
  WorkerTurnRecoveryPendingError,
} from "@/runtime/worker-codex-turn";

const installationId = "qa-company";
const userId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000011";
const threadId = "00000000-0000-4000-8000-000000000021";
const userMessageId = "00000000-0000-4000-8000-000000000031";
const assistantMessageId = "00000000-0000-4000-8000-000000000041";
const fingerprint = "a".repeat(64);
const memoryId = "00000000-0000-4000-8000-000000000051";
const documentUploadId = "00000000-0000-4000-8000-000000000061";
const installationPaths = {
  companyContextRoot: "/company-context",
  sourceReadRoot: "/source-knowledge",
};

function memoryDependencies(
  overrides: {
    buildPromptSnapshot?: MemoryService["buildPromptSnapshot"];
    record?: (event: MemoryTurnAuditEvent) => Promise<MemoryTurnAuditEvent>;
  } = {},
): WorkerTurnMemoryDependencies {
  return {
    memoryService: {
      buildPromptSnapshot: overrides.buildPromptSnapshot ?? (async () => ({
        text: JSON.stringify({
          schemaVersion: 1,
          trust: "untrusted-data-only",
          companyContext: [],
          knowledgeIndex: { content: "" },
          employeeContext: { profile: "Employee A", preferences: "Direct" },
          explicitMemories: [{ memoryId, content: "Approved preference" }],
        }),
        memoryIds: [memoryId],
        truncated: false,
      })),
    } as MemoryService,
    auditSink: {
      record: overrides.record ?? (async (event) => event),
    },
  };
}

function chatRequest(): ChatRequest {
  return {
    projectId,
    threadId,
    userMessageId,
    assistantMessageId,
    message: "Resume el document",
    preferences: { tone: "direct", language: "ca", showActivity: true },
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
}

function permissions(rules: ResolvedPermissions["rules"] = []): ResolvedPermissions {
  return {
    schemaVersion: 1,
    installationId,
    userId,
    roleId: null,
    projectId,
    turnId: assistantMessageId,
    resolvedAt: new Date().toISOString(),
    fingerprint,
    sources: [],
    rules,
    developerInstructions: `Policy fingerprint: ${fingerprint}`,
  };
}

function projectGuidance() {
  return {
    projectId,
    projectName: "Testing 1",
    projectInstructions: "",
    projectMemory: "",
    projectSources: [],
    visibleProjects: [{ id: projectId, name: "Testing 1" }],
    branchHistory: null,
  };
}

describe("worker Codex turn", () => {
  beforeEach(() => {
    mocked.runtime = null;
    mocked.maintenanceLease = null;
    mocked.maintenanceReleases = 0;
    mocked.cancelTurn = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a bounded configurable lifetime for every worker turn", () => {
    expect(workerTurnTimeoutMs({})).toBe(10 * 60_000);
    expect(workerTurnTimeoutMs({ AIBRAIN_WORKER_TURN_TIMEOUT_MS: "30000" })).toBe(30_000);
    expect(workerTurnTimeoutMs({ AIBRAIN_WORKER_TURN_TIMEOUT_MS: "1800000" })).toBe(1_800_000);
    expect(() => workerTurnTimeoutMs({ AIBRAIN_WORKER_TURN_TIMEOUT_MS: "29999" })).toThrow(/between/u);
    expect(() => workerTurnTimeoutMs({ AIBRAIN_WORKER_TURN_TIMEOUT_MS: "secret" })).toThrow(/invalid/u);
  });

  it("uses a short bounded reconciliation grace after local document tools", () => {
    expect(documentToolTerminalGraceMs({})).toBe(45_000);
    expect(documentToolTerminalGraceMs({ AIBRAIN_DOCUMENT_TOOL_TERMINAL_GRACE_MS: "1000" })).toBe(1_000);
    expect(documentToolTerminalGraceMs({ AIBRAIN_DOCUMENT_TOOL_TERMINAL_GRACE_MS: "120000" })).toBe(120_000);
    expect(documentToolTerminalGraceMs({ AIBRAIN_DOCUMENT_TOOL_TERMINAL_GRACE_MS: "999" })).toBe(45_000);
    expect(documentToolTerminalGraceMs({ AIBRAIN_DOCUMENT_TOOL_TERMINAL_GRACE_MS: "secret" })).toBe(45_000);
  });

  it("creates four local formats in one tool call, projects one card per file and closes with no private path", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-document-batch-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    let handlers: {
      onNotification(value: unknown, envelope: unknown): Promise<void> | void;
      onServerRequest(value: unknown, envelope: unknown): Promise<unknown> | unknown;
    } | null = null;
    const calls: string[] = [];
    const envelope = (eventId: string, sequence: number) => ({
      eventId,
      sequence,
      occurredAt: new Date().toISOString(),
      message: { kind: "rpc-notification", rpc: {} },
    });
    const client = {
      router: {
        registerTurn(_runtimeThreadId: string, _localTurnId: string, value: typeof handlers) {
          handlers = value;
          return { bindRuntimeTurn() {}, dispose() {} };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: true,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push(method);
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-documents", turns: [] } };
          await beforeResolve?.(result as never, envelope("documents-thread", 1) as never);
          return result;
        }
        if (method === "turn/start") {
          const result = { turn: { id: "runtime-turn-documents" } };
          await beforeResolve?.(result as never, envelope("documents-turn", 2) as never);
          queueMicrotask(() => {
            void (async () => {
              if (!handlers) throw new Error("Turn handlers were not registered.");
              const toolResult = await handlers.onServerRequest({
                method: "item/tool/call",
                id: "document-batch-request",
                params: {
                  threadId: "runtime-thread-documents",
                  turnId: "runtime-turn-documents",
                  callId: "document-batch-call",
                  namespace: "aibrain_documents",
                  tool: "create_batch",
                  arguments: {
                    files: (["pdf", "docx", "pptx", "xlsx"] as const).map((format) => ({
                      format,
                      fileName: `hello-world.${format}`,
                      title: "Hello world",
                      content: "Hello world",
                      ...(format === "xlsx" ? { rows: [["Message"], ["Hello world"]] } : {}),
                    })),
                  },
                },
              }, envelope("documents-tool-request", 3));
              const privatePath = path.join(
                workspace,
                "projects",
                projectId,
                "documents",
                "hello-world.pdf",
              );
              await handlers.onNotification({
                method: "item/completed",
                params: {
                  threadId: "runtime-thread-documents",
                  turnId: "runtime-turn-documents",
                  item: {
                    id: "document-batch-call",
                    type: "dynamicToolCall",
                    namespace: "aibrain_documents",
                    tool: "create_batch",
                    status: "completed",
                    aggregatedOutput: privatePath,
                    ...(toolResult as Record<string, unknown>),
                  },
                },
              }, envelope("documents-tool-completed", 4));
              await handlers.onNotification({
                method: "item/started",
                params: {
                  threadId: "runtime-thread-documents",
                  turnId: "runtime-turn-documents",
                  item: { id: "documents-final", type: "agentMessage", phase: "final_answer", text: "" },
                },
              }, envelope("documents-final-started", 5));
              await handlers.onNotification({
                method: "item/agentMessage/delta",
                params: {
                  threadId: "runtime-thread-documents",
                  turnId: "runtime-turn-documents",
                  itemId: "documents-final",
                  delta: `Listo: ${privatePath}`,
                },
              }, envelope("documents-final-delta", 6));
              await handlers.onNotification({
                method: "item/completed",
                params: {
                  threadId: "runtime-thread-documents",
                  turnId: "runtime-turn-documents",
                  item: {
                    id: "documents-final",
                    type: "agentMessage",
                    phase: "final_answer",
                    status: "completed",
                    text: `Listo: ${privatePath}`,
                  },
                },
              }, envelope("documents-final", 7));
              await handlers.onNotification({
                method: "turn/completed",
                params: {
                  threadId: "runtime-thread-documents",
                  turn: { id: "runtime-turn-documents", status: "completed", items: [], error: null },
                },
              }, envelope("documents-completed", 8));
            })();
          });
          return result;
        }
        throw new Error(`Unexpected request ${method} (${purpose})`);
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const events: Array<Record<string, unknown>> = [];
    const request = chatRequest();
    request.message = "Genera PDF, DOCX, PPTX y XLSX que digan hello world";

    await runWorkerCodexTurn(
      request,
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions([{
        ruleId: "tools.execute",
        action: "execute",
        effect: "allow",
        instruction: "Create local documents.",
        sourceScope: "installation",
        sourcePolicyVersion: 1,
        precedence: 100,
      }]),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    const artifacts = events.filter((event) => event.type === "artifact");
    expect(artifacts).toHaveLength(4);
    expect(new Set(artifacts.map((event) => (event.item as { id: string }).id))).toHaveProperty("size", 4);
    expect(artifacts.map((event) => (event.item as { kind: string }).kind)).toEqual(["pdf", "docx", "pptx", "xlsx"]);
    const finalContent = events.filter((event) => event.type === "content").at(-1);
    expect(finalContent).toEqual({ type: "content", value: "Listo: ./documents/hello-world.pdf" });
    expect(JSON.stringify(events)).not.toContain(userRoot);
    expect(events).toContainEqual({ type: "done" });
    expect(calls).toEqual(["thread/start", "turn/start"]);
  }, 30_000);

  it("keeps live web search and the private browser exposed for a current Arnall query", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-turn-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    const documentPath = path.join(staging, "threads", threadId, "uploads", documentUploadId, "notes.txt");
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.dirname(documentPath), { recursive: true, mode: 0o700 });
      await writeFile(documentPath, "Attachment text\n", { mode: 0o600 });
    });
    let handlers: {
      onNotification(value: unknown, envelope?: unknown): Promise<void> | void;
      onFailure(error: Error): void;
    } | null = null;
    let boundTurn: string | null = null;
    const calls: Array<{ method: string; params: unknown; purpose: string }> = [];
    const router = {
      registerTurn(runtimeThreadId: string, localTurnId: string, value: typeof handlers) {
        expect(runtimeThreadId).toBe("runtime-thread-1");
        expect(localTurnId).toBe(assistantMessageId);
        handlers = value;
        return {
          threadId: runtimeThreadId,
          localTurnId,
          bindRuntimeTurn(turnId: string) { boundTurn = turnId; },
          dispose() {},
        };
      },
    };
    let modelCatalogCalls = 0;
    const client = {
      router,
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async connection() {
        modelCatalogCalls += 1;
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: true,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async capabilities() { return { webSearch: true, imageGeneration: false }; },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push({ method, params, purpose });
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-1" } };
          await beforeResolve?.(result as never, {
            eventId: "response-thread",
            sequence: 1,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/start") {
          const result = { turn: { id: "runtime-turn-1" } };
          await beforeResolve?.(result as never, {
            eventId: "response-turn",
            sequence: 2,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          queueMicrotask(() => {
            void (async () => {
              await handlers?.onNotification({
                method: "turn/started",
                params: {
                  threadId: "runtime-thread-1",
                  turn: { id: "runtime-turn-1", status: "inProgress", items: [], error: null },
                },
              });
              await handlers?.onNotification({
                method: "item/reasoning/summaryPartAdded",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  itemId: "reasoning-1",
                  summaryIndex: 0,
                },
              });
              await handlers?.onNotification({
                method: "item/reasoning/textDelta",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  itemId: "reasoning-1",
                  delta: "private reasoning must not be exposed",
                  contentIndex: 0,
                },
              });
              await handlers?.onNotification({
                method: "item/reasoning/summaryTextDelta",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  itemId: "reasoning-1",
                  delta: "Analitzant la petició",
                  summaryIndex: 0,
                },
              });
              await handlers?.onNotification({
                method: "rawResponseItem/completed",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  item: {
                    id: "reasoning-raw-1",
                    type: "reasoning",
                    summary: [{ type: "summary_text", text: "Resum final verificat" }],
                    encrypted_content: null,
                  },
                },
              });
              await handlers?.onNotification({
                method: "item/agentMessage/delta",
                params: { threadId: "runtime-thread-1", turnId: "runtime-turn-1", itemId: "commentary-1", delta: "**Voy a comprobar la fuente autorizada.** Codex Instalación: company-qa /var/lib/aibrain/data/users/fc71a2c4-0db0-4914-af82-9564038ea964/runtime/codex-home/skills/web/SKILL.md" },
              }, { eventId: "commentary-delta", sequence: 10, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/started",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  item: { id: "commentary-1", type: "agentMessage", text: "", phase: "commentary", status: "inProgress" },
                },
              }, { eventId: "commentary-started", sequence: 11, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/completed",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  item: { id: "commentary-1", type: "agentMessage", text: "**Voy a comprobar la fuente autorizada.** Codex Instalación: company-qa /var/lib/aibrain/data/users/fc71a2c4-0db0-4914-af82-9564038ea964/runtime/codex-home/skills/web/SKILL.md", phase: "commentary", status: "completed" },
                },
              }, { eventId: "commentary-completed", sequence: 12, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/agentMessage/delta",
                params: { threadId: "runtime-thread-1", turnId: "runtime-turn-1", itemId: "message-1", delta: "Resultado " },
              }, { eventId: "final-delta", sequence: 13, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/started",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  item: { id: "message-1", type: "agentMessage", text: "", phase: "final_answer", status: "inProgress" },
                },
              }, { eventId: "final-started", sequence: 14, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/agentMessage/delta",
                params: { threadId: "runtime-thread-1", turnId: "runtime-turn-1", itemId: "message-1", delta: "fc71a2c4-0db0-" },
              }, { eventId: "final-id-fragment-1", sequence: 15, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "item/agentMessage/delta",
                params: { threadId: "runtime-thread-1", turnId: "runtime-turn-1", itemId: "message-1", delta: "4914-af82-9564038ea964." },
              }, { eventId: "final-id-fragment-2", sequence: 16, occurredAt: new Date().toISOString(), message: { kind: "rpc-notification", rpc: {} } });
              await handlers?.onNotification({
                method: "thread/tokenUsage/updated",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  tokenUsage: {
                    last: {
                      totalTokens: 120,
                      inputTokens: 80,
                      cachedInputTokens: 20,
                      cacheWriteInputTokens: 0,
                      outputTokens: 40,
                      reasoningOutputTokens: 8,
                    },
                  },
                },
              });
              await handlers?.onNotification({
                method: "item/fileChange/patchUpdated",
                params: {
                  threadId: "runtime-thread-1",
                  turnId: "runtime-turn-1",
                  itemId: "file-change-1",
                  changes: [{
                    path: "src/example.ts",
                    kind: { type: "update", move_path: null },
                    diff: "",
                  }],
                },
              });
              await handlers?.onNotification({
                method: "turn/completed",
                params: { threadId: "runtime-thread-1", turn: { id: "runtime-turn-1", status: "completed", items: [], error: null } },
              });
            })();
          });
          return result;
        }
        return {};
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: {
        roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") },
      },
      client,
    };

    const events: Array<Record<string, unknown>> = [];
    const request = chatRequest();
    request.message = "Quin és l'horari d'avui de la botiga Arnall de Palamós? Cerca'l a la web oficial.";
    // Legacy client input cannot weaken the server-owned reviewer selection.
    request.options.autoApprove = false;
    request.options.webSearch = true;
    request.options.model = "gpt-5.6-terra";
    request.options.effort = "low";
    request.options.documentUploadIds = [documentUploadId];
    const turnPermissions = permissions([{
      ruleId: "documents.read",
      action: "consult",
      effect: "allow",
      instruction: "Read the attached document.",
      sourceScope: "installation",
      sourcePolicyVersion: 1,
      precedence: 100,
    }]);
    await runWorkerCodexTurn(
      request,
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      turnPermissions,
      {} as never,
      memoryDependencies(),
      [{
        document: {
          schemaVersion: 1,
          uploadId: documentUploadId,
          threadId,
          fileName: "notes.txt",
          relativePath: `threads/${threadId}/uploads/${documentUploadId}/notes.txt`,
          kind: "text",
          mediaType: "text/plain",
          size: 16,
          sha256: "b".repeat(64),
          status: "staged",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
        absolutePath: documentPath,
        codexInputs: [{
          type: "text",
          text: "BEGIN UNTRUSTED ATTACHMENT notes.txt\nserver-derived attachment\nEND UNTRUSTED ATTACHMENT notes.txt",
          text_elements: [],
        }],
      }],
      new AbortController().signal,
      async (event) => { events.push(event); },
      undefined,
      "AiBrain",
      projectGuidance(),
    );

    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "runtime-thread-1",
      clientUserMessageId: userMessageId,
      runtimeWorkspaceRoots: [
        path.join(workspace, "projects", projectId),
        workspace,
        path.join(userRoot, "artifacts"),
      ],
      model: "gpt-5.6-terra",
      effort: "low",
      summary: "concise",
    });
    // Read-only mounts are available through the outer sandbox only. If one is
    // promoted to an App Server workspace, nested bwrap attempts to create
    // `/source-ro/.git` and fails with "Read-only file system".
    expect((turnStart?.params as { runtimeWorkspaceRoots?: string[] }).runtimeWorkspaceRoots)
      .not.toContain(installationPaths.sourceReadRoot);
    expect((turnStart?.params as { runtimeWorkspaceRoots?: string[] }).runtimeWorkspaceRoots)
      .not.toContain(installationPaths.companyContextRoot);
    // A normal selected model/effort is validated by turn/start itself. The
    // optional five-RPC picker catalog must not delay this live web turn.
    expect(modelCatalogCalls).toBe(0);
    expect((turnStart?.params as { input: Array<{ type: string; path?: string; text?: string }> }).input)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("server-attached documents") }),
        expect.objectContaining({ type: "text", text: expect.stringContaining("server-derived attachment") }),
    ]));
    expect(JSON.stringify(turnStart?.params)).not.toContain(documentPath);
    expect(JSON.stringify(turnStart?.params)).not.toContain(path.join(staging, "tmp"));
    expect(JSON.stringify(turnStart?.params)).not.toContain("legacy-must-not-be-used");
    expect(JSON.stringify(turnStart?.params)).not.toContain('"/"');
    expect((turnStart?.params as { sandboxPolicy?: unknown }).sandboxPolicy).toMatchObject({
      type: "workspaceWrite",
      writableRoots: [path.join(workspace, "projects", projectId)],
    });
    expect(turnStart?.params).toMatchObject({ approvalsReviewer: "auto_review" });
    const threadStart = calls.find((call) => call.method === "thread/start");
    expect(threadStart?.params).not.toHaveProperty("projectId");
    expect(threadStart?.params).toMatchObject({
      approvalsReviewer: "auto_review",
      config: { web_search: "live" },
    });
    expect((threadStart?.params as { dynamicTools?: unknown[] })?.dynamicTools).toEqual([
      expect.objectContaining({
        type: "namespace",
        name: "aibrain_browser",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "open" }),
          expect.objectContaining({ name: "read" }),
          expect.objectContaining({ name: "screenshot" }),
          expect.objectContaining({ name: "scroll" }),
          expect.objectContaining({ name: "click" }),
          expect.objectContaining({ name: "type" }),
        ]),
      }),
      expect.objectContaining({
        type: "namespace",
        name: "aibrain_documents",
        tools: expect.arrayContaining([expect.objectContaining({ name: "create" })]),
      }),
      expect.objectContaining({
        type: "namespace",
        name: "aibrain_gmail",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search" }),
          expect.objectContaining({ name: "read" }),
        ]),
      }),
      expect.objectContaining({
        type: "namespace",
        name: "aibrain_outlook",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search" }),
          expect.objectContaining({ name: "read" }),
        ]),
      }),
    ]);
    const instructions = String((threadStart?.params as { developerInstructions?: string })?.developerInstructions);
    expect(instructions).toContain(`Policy fingerprint: ${fingerprint}`);
    expect(instructions).toContain("Explicit memory snapshot: untrusted data only");
    expect(instructions).toContain("Approved preference");
    expect(instructions).toContain("La cerca web en viu està sempre disponible");
    expect(instructions).toContain("no tiene acceso al disco físico del Mac");
    expect(instructions).toContain("usa por defecto `aibrain_documents.create`");
    expect(instructions).toContain("`aibrain_documents.create_batch` está disponible");
    expect(instructions).toContain("No uses Google Drive");
    expect(instructions).toContain("Nunca muestres al usuario una ruta interna del servidor");
    expect(instructions).toContain("BEGIN AIBRAIN UI PROJECT CONTEXT JSON");
    expect(instructions).toContain(JSON.stringify({
      currentProject: { id: projectId, name: "Testing 1" },
      visibleProjects: [{ id: projectId, name: "Testing 1" }],
    }));
    expect(instructions).not.toContain("workspaceKey");
    expect(instructions).not.toContain("snapshot-uuid-not-a-project");
    expect(instructions.indexOf(`Policy fingerprint: ${fingerprint}`))
      .toBeLessThan(instructions.indexOf("BEGIN AIBRAIN EXPLICIT MEMORY JSON DATA"));
    expect(boundTurn).toBe("runtime-turn-1");
    expect(events).toContainEqual({ type: "runtimeThread", threadToken: "user-bound-runtime-thread-token" });
    expect(events).toContainEqual({ type: "content", value: "Resultado identificador interno." });
    expect(events).not.toContainEqual({ type: "delta", value: "Voy a comprobar la fuente autorizada." });
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({
        id: "commentary-1",
        kind: "reasoning",
        detail: expect.stringContaining("Voy a comprobar la fuente autorizada."),
      }),
    }));
    expect(events).toContainEqual({
      type: "activity",
      item: {
        id: "file-change-1",
        kind: "file",
        label: "Preparant canvis",
        detail: "src/example.ts",
        files: [{ path: "src/example.ts", change: "update" }],
        status: "running",
      },
    });
    expect(events).toContainEqual({
      type: "runtimeUsage",
      tokenUsage: {
        totalTokens: 120,
        inputTokens: 80,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 0,
        outputTokens: 40,
        reasoningOutputTokens: 8,
      },
    });
    expect(events).toContainEqual({ type: "done" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ label: "Preparant el context", status: "running" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ label: "Preparant el resum del raonament" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ kind: "reasoning", detail: "Analitzant la petició" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ kind: "reasoning", detail: "Resum final verificat" }),
    }));
    expect(events.filter((event) => event.type === "delta")).toEqual([]);
    expect(events.filter((event) => event.type === "content")).toEqual([
      { type: "content", value: "Resultado " },
      { type: "content", value: "Resultado identificador interno." },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private reasoning must not be exposed|\*\*|Codex|AiBrain|\/var\/lib|company-qa|fc71a2c4/iu);
    expect(mocked.maintenanceReleases).toBe(1);
  });

  it("interrupts App Server when stop is requested while turn/start is still resolving", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-pending-stop-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    const calls: string[] = [];
    const client = {
      router: {
        registerTurn(runtimeThreadId: string, localTurnId: string) {
          return {
            threadId: runtimeThreadId,
            localTurnId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push(method);
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-pending-stop" } };
          await beforeResolve?.(result as never, {
            eventId: "pending-thread-response",
            sequence: 1,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/start") {
          expect(mocked.cancelTurn).not.toBeNull();
          mocked.cancelTurn!(false);
          const result = { turn: { id: "runtime-turn-pending-stop" } };
          await beforeResolve?.(result as never, {
            eventId: "pending-turn-response",
            sequence: 2,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/interrupt") return {};
        throw new Error(`Unexpected request ${method}`);
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const events: Array<Record<string, unknown>> = [];

    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls).toEqual(["thread/start", "turn/start", "turn/interrupt"]);
    expect(events).toContainEqual({ type: "runtimeTurn", turnId: "runtime-turn-pending-stop" });
    expect(events).toContainEqual({ type: "stopped" });
    expect(events).not.toContainEqual({ type: "done" });
  });

  it("recovers a timed-out turn/start from App Server without creating a duplicate turn", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-timeout-recovery-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    let handlers: { onNotification(value: unknown, envelope: unknown): Promise<void> | void } | null = null;
    const calls: string[] = [];
    const client = {
      router: {
        registerTurn(runtimeThreadId: string, localTurnId: string, value: typeof handlers) {
          handlers = value;
          return {
            threadId: runtimeThreadId,
            localTurnId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push(method);
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-timeout" } };
          await beforeResolve?.(result as never, {
            eventId: "timeout-thread-response",
            sequence: 1,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/start") {
          throw new AppServerRequestTimeoutError("turn/start", purpose, 60_000);
        }
        if (method === "thread/read") {
          const result = {
            thread: {
              id: "runtime-thread-timeout",
              turns: [{
                id: "runtime-turn-timeout",
                status: "inProgress",
                error: null,
                items: [{ type: "userMessage", id: "user-item", clientId: userMessageId, content: [] }],
              }],
            },
          };
          queueMicrotask(() => {
            void handlers?.onNotification({
              method: "turn/completed",
              params: {
                threadId: "runtime-thread-timeout",
                turn: { id: "runtime-turn-timeout", status: "completed", items: [], error: null },
              },
            }, {
              eventId: "timeout-turn-completed",
              sequence: 3,
              occurredAt: new Date().toISOString(),
              message: { kind: "rpc-notification", rpc: {} },
            });
          });
          throw new AppServerRequestTimeoutError(
            "thread/read",
            purpose,
            15_000,
            Promise.resolve(result),
          );
        }
        throw new Error(`Unexpected request ${method}`);
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const events: Array<Record<string, unknown>> = [];

    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls).toEqual(["thread/start", "turn/start", "thread/read"]);
    expect(events).toContainEqual({ type: "runtimeTurn", turnId: "runtime-turn-timeout" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({
        id: "runtime-turn-recovery",
        label: "Torn recuperat",
        status: "complete",
      }),
    }));
    expect(events).toContainEqual({ type: "done" });
  });

  it("reconciles and interrupts a document turn that never produces a final answer", async () => {
    vi.stubEnv("AIBRAIN_TURN_IDLE_TIMEOUT_MS", "5000");
    vi.stubEnv("AIBRAIN_TURN_HARD_TIMEOUT_MS", "5000");
    vi.stubEnv("AIBRAIN_DOCUMENT_TOOL_TERMINAL_GRACE_MS", "1000");
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-watchdog-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    const calls: string[] = [];
    let handlers: {
      onServerRequest(request: unknown, envelope: unknown): Promise<unknown> | unknown;
    } | null = null;
    const client = {
      router: {
        registerTurn(runtimeThreadId: string, localTurnId: string, value: typeof handlers) {
          handlers = value;
          return {
            threadId: runtimeThreadId,
            localTurnId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: true,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      prewarmConnection() {},
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push(method);
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-watchdog", turns: [] } };
          await beforeResolve?.(result as never, {
            eventId: "watchdog-thread",
            sequence: 1,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/start") {
          const result = { turn: { id: "runtime-turn-watchdog" } };
          await beforeResolve?.(result as never, {
            eventId: "watchdog-turn",
            sequence: 2,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          queueMicrotask(() => {
            void handlers?.onServerRequest({
              method: "item/tool/call",
              id: "watchdog-document-call",
              params: {
                threadId: "runtime-thread-watchdog",
                turnId: "runtime-turn-watchdog",
                callId: "watchdog-document-call",
                namespace: "aibrain_documents",
                tool: "create",
                arguments: {
                  format: "pdf",
                  fileName: "hello-world.pdf",
                  title: "Hello world",
                  content: "Hello world",
                },
              },
            }, {
              eventId: "watchdog-document-request",
              sequence: 3,
              occurredAt: new Date().toISOString(),
              message: { kind: "rpc-request", rpc: {} },
            });
          });
          return result;
        }
        if (method === "thread/read") {
          return {
            thread: {
              id: "runtime-thread-watchdog",
              turns: [{
                id: "runtime-turn-watchdog",
                status: "inProgress",
                error: null,
                items: [{ type: "userMessage", id: "user-item", clientId: userMessageId, content: [] }],
              }],
            },
          };
        }
        if (method === "turn/interrupt") return {};
        throw new Error(`Unexpected request ${method}`);
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const events: Array<Record<string, unknown>> = [];

    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions([{
        ruleId: "tools.execute",
        action: "execute",
        effect: "allow",
        instruction: "Create local documents.",
        sourceScope: "installation",
        sourcePolicyVersion: 1,
        precedence: 100,
      }]),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls).toEqual(["thread/start", "turn/start", "thread/read", "turn/interrupt"]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      message: expect.stringContaining("sin repetir ninguna creación"),
    }));
    expect(events).not.toContainEqual({ type: "done" });
  }, 15_000);

  it("recovers a completed turn after thread/resume times out without retrying a model action", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-recovery-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    const calls: string[] = [];
    const client = {
      canReuseLoadedThread() { return false; },
      router: {
        registerTurn() { throw new Error("A completed recovery must not register a live turn."); },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push(method);
        if (method === "thread/resume") {
          throw new AppServerRequestTimeoutError("thread/resume", purpose, 60_000);
        }
        if (method !== "thread/read") throw new Error(`Unexpected request ${method}`);
        const result = {
          thread: {
            id: "runtime-thread-1",
            turns: [{
              id: "runtime-turn-recovered",
              status: "completed",
              error: null,
              items: [
                { type: "userMessage", id: "item-user", clientId: userMessageId, content: [] },
                { type: "agentMessage", id: "item-commentary", text: "Recovered public progress", phase: "commentary" },
                { type: "agentMessage", id: "item-agent", text: "Recovered answer", phase: "final_answer" },
              ],
            }],
          },
        };
        await beforeResolve?.(result as never, {
          eventId: "response-thread-read",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          message: { kind: "rpc-response", rpc: { id: purpose, result } },
        } as never);
        return result;
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const events: Array<Record<string, unknown>> = [];
    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      "runtime-thread-1",
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls).toEqual(["thread/resume", "thread/read"]);
    expect(events).toContainEqual({ type: "runtimeTurn", turnId: "runtime-turn-recovered" });
    expect(events).toContainEqual({ type: "content", value: "Recovered answer" });
    expect(events).not.toContainEqual({ type: "content", value: "Recovered public progress" });
    expect(events).toContainEqual({
      type: "activity",
      item: expect.objectContaining({ id: "item-commentary", kind: "reasoning", detail: "Recovered public progress" }),
    });
    expect(events).toContainEqual({ type: "done" });
  });

  it("starts a turn directly when the thread is already loaded in the warm App Server", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-warm-thread-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    let handlers: { onNotification(value: unknown): Promise<void> | void } | null = null;
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      canReuseLoadedThread(runtimeThreadId: string, webSearchEnabled: boolean) {
        return runtimeThreadId === "runtime-thread-1" && webSearchEnabled === true;
      },
      router: {
        registerTurn(_runtimeThreadId: string, _localTurnId: string, value: typeof handlers) {
          handlers = value;
          return {
            threadId: "runtime-thread-1",
            localTurnId: assistantMessageId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        calls.push({ method, params });
        if (method !== "turn/start") throw new Error(`Unexpected request ${method}`);
        const result = { turn: { id: "runtime-turn-warm" } };
        await beforeResolve?.(result as never, {
          eventId: "response-turn-warm",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          message: { kind: "rpc-response", rpc: { id: purpose, result } },
        } as never);
        queueMicrotask(() => {
          void handlers?.onNotification({
            method: "turn/completed",
            params: {
              threadId: "runtime-thread-1",
              turn: { id: "runtime-turn-warm", status: "completed", items: [], error: null },
            },
          });
        });
        return result;
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
      workerWasWarm: true,
    };
    const events: Array<Record<string, unknown>> = [];

    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      "runtime-thread-1",
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls.map(({ method }) => method)).toEqual(["turn/start"]);
    expect(calls[0]?.params).toMatchObject({
      threadId: "runtime-thread-1",
      summary: "concise",
      additionalContext: {
        "aibrain.turn": {
          kind: "application",
          value: expect.stringContaining(`Policy fingerprint: ${fingerprint}`),
        },
      },
    });
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "activity",
      item: expect.objectContaining({ id: "runtime-thread" }),
    }));
    expect(events).toContainEqual({ type: "done" });
  });

  it("keeps an active remote turn recoverable when the App Server event stream restarts", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-stream-restart-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    let handlers: { onFailure(error: Error): void } | null = null;
    const client = {
      canReuseLoadedThread: () => true,
      router: {
        registerTurn(_runtimeThreadId: string, _localTurnId: string, value: typeof handlers) {
          handlers = value;
          return {
            threadId: "runtime-thread-restart",
            localTurnId: assistantMessageId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        if (method !== "turn/start") throw new Error(`Unexpected request ${method}`);
        const result = { turn: { id: "runtime-turn-restart" } };
        await beforeResolve?.(result as never, {
          eventId: "response-turn-restart",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          message: { kind: "rpc-response", rpc: { id: purpose, result } },
        } as never);
        queueMicrotask(() => handlers?.onFailure(new Error("App Server transport event stream closed unexpectedly.")));
        return result;
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
      workerWasWarm: true,
    };
    const events: Array<Record<string, unknown>> = [];

    await expect(runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      "runtime-thread-restart",
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/legacy-must-not-be-used",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    )).rejects.toBeInstanceOf(WorkerTurnRecoveryPendingError);

    expect(events).not.toContainEqual(expect.objectContaining({ type: "error" }));
    expect(events).not.toContainEqual({ type: "done" });
  });

  it("declines generic App Server execution requests server-side when tools.execute is denied", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-deny-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(path.join(staging, "threads"), { recursive: true, mode: 0o700 });
    });
    let handlers: {
      onServerRequest(request: unknown, envelope: unknown): Promise<unknown>;
      onNotification(value: unknown): Promise<void> | void;
    } | null = null;
    const responses: unknown[] = [];
    const client = {
      router: {
        registerTurn(_threadId: string, _localTurnId: string, value: typeof handlers) {
          handlers = value;
          return {
            threadId: "runtime-thread-deny",
            localTurnId: assistantMessageId,
            bindRuntimeTurn() {},
            dispose() {},
          };
        },
      },
      async connectionSummary() {
        return {
          connected: true,
          authMode: "chatgpt",
          planType: "team",
          models: [],
          skills: [],
          webSearch: false,
          imageGeneration: false,
          processWarm: true,
          rateLimit: null,
          usage: null,
        };
      },
      async resolvedSkills() { return []; },
      async request(
        method: string,
        _params: unknown,
        purpose: string,
        _timeout?: number,
        beforeResolve?: (value: never, event: never) => Promise<void> | void,
      ) {
        if (method === "thread/start") {
          const result = { thread: { id: "runtime-thread-deny" } };
          await beforeResolve?.(result as never, {
            eventId: "deny-thread-response",
            sequence: 1,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          return result;
        }
        if (method === "turn/start") {
          const result = { turn: { id: "runtime-turn-deny" } };
          await beforeResolve?.(result as never, {
            eventId: "deny-turn-response",
            sequence: 2,
            occurredAt: new Date().toISOString(),
            message: { kind: "rpc-response", rpc: { id: purpose, result } },
          } as never);
          queueMicrotask(() => {
            void (async () => {
              for (const [index, requestMethod] of [
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
                "item/permissions/requestApproval",
              ].entries()) {
                const request = {
                  id: index + 1,
                  method: requestMethod,
                  params: {
                    threadId: "runtime-thread-deny",
                    turnId: "runtime-turn-deny",
                    itemId: `denied-${index}`,
                    command: "touch forbidden",
                    permissions: { fileSystem: { write: ["/forbidden"] } },
                  },
                };
                responses.push(await handlers!.onServerRequest(request, {
                  eventId: `deny-request-${index}`,
                  sequence: index + 3,
                  occurredAt: new Date().toISOString(),
                  message: { kind: "server-request", rpc: request },
                }));
              }
              await handlers!.onNotification({
                method: "turn/completed",
                params: {
                  threadId: "runtime-thread-deny",
                  turn: { id: "runtime-turn-deny", status: "completed", items: [], error: null },
                },
              });
            })();
          });
          return result;
        }
        return {};
      },
    };
    mocked.runtime = {
      config: { installationId, paths: installationPaths },
      handle: { roots: { workspace, staging, artifacts: path.join(userRoot, "artifacts") } },
      client,
    };
    const approvalStore = {
      createPending: vi.fn(() => { throw new Error("A policy denial must not create a pending approval."); }),
    };
    const events: Array<Record<string, unknown>> = [];
    await runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/unused",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions([{
        ruleId: "tools.execute",
        action: "execute",
        effect: "deny",
        instruction: "Do not execute generic tools.",
        sourceScope: "user",
        sourcePolicyVersion: 1,
        precedence: 400,
      }]),
      approvalStore as never,
      memoryDependencies(),
      [],
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(approvalStore.createPending).not.toHaveBeenCalled();
    expect(responses).toEqual([
      { decision: "decline" },
      { decision: "decline" },
      { permissions: {}, scope: "turn" },
    ]);
    expect(events.filter((event) => event.type === "approval")).toHaveLength(3);
    expect(events.filter((event) => event.type === "approval"))
      .toEqual(events.filter((event) => event.type === "approval").map((event) =>
        expect.objectContaining({ item: expect.objectContaining({ status: "declined" }) })));
  });

  it("fails closed before contacting a worker when the memory store is unavailable", async () => {
    let audited = false;
    await expect(runWorkerCodexTurn(
      chatRequest(),
      installationId,
      userId,
      null,
      {
        tenantId: installationId,
        mode: "codex",
        codexBinary: "codex",
        codexHome: null,
        workspace: "/unused",
        model: null,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
      permissions(),
      {} as never,
      memoryDependencies({
        buildPromptSnapshot: async () => { throw new Error("corrupt memory journal"); },
        record: async (event) => { audited = true; return event; },
      }),
      [],
      new AbortController().signal,
      async () => undefined,
    )).rejects.toMatchObject({ code: "MEMORY_TURN_SNAPSHOT_UNAVAILABLE" });
    expect(audited).toBe(false);
    expect(mocked.runtime).toBeNull();
    expect(mocked.maintenanceReleases).toBe(1);
  });
});
