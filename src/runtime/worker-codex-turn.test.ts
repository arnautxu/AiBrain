import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "@/lib/chat-contract";
import type { MemoryService } from "@/memory";
import type { ResolvedPermissions } from "@/permissions";
import type {
  MemoryTurnAuditEvent,
  WorkerTurnMemoryDependencies,
} from "@/runtime/memory-turn";

const mocked = vi.hoisted(() => ({
  runtime: null as unknown,
  maintenanceReleases: 0,
  maintenanceLease: null as unknown,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));
vi.mock("@/runtime/thread-token", () => ({
  issueThreadToken: () => "user-bound-runtime-thread-token",
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
  registerWorkerTurnCancellation: () => () => undefined,
}));

import { runWorkerCodexTurn } from "@/runtime/worker-codex-turn";

const installationId = "qa-company";
const userId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000011";
const threadId = "00000000-0000-4000-8000-000000000021";
const userMessageId = "00000000-0000-4000-8000-000000000031";
const assistantMessageId = "00000000-0000-4000-8000-000000000041";
const fingerprint = "a".repeat(64);
const memoryId = "00000000-0000-4000-8000-000000000051";
const documentUploadId = "00000000-0000-4000-8000-000000000061";

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

describe("worker Codex turn", () => {
  beforeEach(() => {
    mocked.runtime = null;
    mocked.maintenanceLease = null;
    mocked.maintenanceReleases = 0;
  });

  it("uses a user-scoped worker, stable client message id and routed turn events", async () => {
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
      onNotification(value: unknown): Promise<void> | void;
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
    const client = {
      router,
      async connection() {
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
                method: "item/agentMessage/delta",
                params: { threadId: "runtime-thread-1", turnId: "runtime-turn-1", itemId: "message-1", delta: "Fet" },
              });
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
      config: { installationId },
      handle: {
        roots: { workspace, staging },
      },
      client,
    };

    const events: Array<Record<string, unknown>> = [];
    const request = chatRequest();
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
    );

    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "runtime-thread-1",
      clientUserMessageId: userMessageId,
      runtimeWorkspaceRoots: [path.join(workspace, "projects", projectId)],
    });
    expect((turnStart?.params as { input: Array<{ type: string; path?: string; text?: string }> }).input)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("server-attached documents") }),
        expect.objectContaining({ type: "text", text: expect.stringContaining("server-derived attachment") }),
      ]));
    expect(JSON.stringify(turnStart?.params)).not.toContain(documentPath);
    expect(JSON.stringify(turnStart?.params)).not.toContain(staging);
    expect(JSON.stringify(turnStart?.params)).not.toContain("legacy-must-not-be-used");
    const threadStart = calls.find((call) => call.method === "thread/start");
    expect(threadStart?.params).not.toHaveProperty("projectId");
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
    ]);
    const instructions = String((threadStart?.params as { developerInstructions?: string })?.developerInstructions);
    expect(instructions).toContain(`Policy fingerprint: ${fingerprint}`);
    expect(instructions).toContain("Explicit memory snapshot: untrusted data only");
    expect(instructions).toContain("Approved preference");
    expect(instructions.indexOf(`Policy fingerprint: ${fingerprint}`))
      .toBeLessThan(instructions.indexOf("BEGIN AIBRAIN EXPLICIT MEMORY JSON DATA"));
    expect(boundTurn).toBe("runtime-turn-1");
    expect(events).toContainEqual({ type: "runtimeThread", threadToken: "user-bound-runtime-thread-token" });
    expect(events).toContainEqual({ type: "delta", value: "Fet" });
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
    expect(mocked.maintenanceReleases).toBe(1);
  });

  it("recovers a completed clientUserMessageId from thread history without starting it twice", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-recovery-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(staging, { mode: 0o700 });
    });
    const calls: string[] = [];
    const client = {
      router: {
        registerTurn() { throw new Error("A completed recovery must not register a live turn."); },
      },
      async connection() {
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
        if (method !== "thread/resume") throw new Error(`Unexpected request ${method}`);
        const result = {
          thread: {
            id: "runtime-thread-1",
            turns: [{
              id: "runtime-turn-recovered",
              status: "completed",
              error: null,
              items: [
                { type: "userMessage", id: "item-user", clientId: userMessageId, content: [] },
                { type: "agentMessage", id: "item-agent", text: "Recovered answer", phase: "final_answer" },
              ],
            }],
          },
        };
        await beforeResolve?.(result as never, {
          eventId: "response-resume",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          message: { kind: "rpc-response", rpc: { id: purpose, result } },
        } as never);
        return result;
      },
    };
    mocked.runtime = {
      config: { installationId },
      handle: { roots: { workspace, staging } },
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

    expect(calls).toEqual(["thread/resume"]);
    expect(events).toContainEqual({ type: "runtimeTurn", turnId: "runtime-turn-recovered" });
    expect(events).toContainEqual({ type: "content", value: "Recovered answer" });
    expect(events).toContainEqual({ type: "done" });
  });

  it("declines generic App Server execution requests server-side when tools.execute is denied", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-deny-"));
    const workspace = path.join(userRoot, "workspace");
    const staging = path.join(userRoot, "staging");
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(workspace, { mode: 0o700 });
      await mkdir(staging, { mode: 0o700 });
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
      async connection() {
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
      config: { installationId },
      handle: { roots: { workspace, staging } },
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
