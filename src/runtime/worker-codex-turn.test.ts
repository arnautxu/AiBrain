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

const mocked = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));
vi.mock("@/runtime/thread-token", () => ({
  issueThreadToken: () => "user-bound-runtime-thread-token",
}));
vi.mock("@/runtime/worker-runtime-service", () => ({
  workerAppServerForUser: async () => mocked.runtime,
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

function permissions(): ResolvedPermissions {
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
    rules: [],
    developerInstructions: `Policy fingerprint: ${fingerprint}`,
  };
}

describe("worker Codex turn", () => {
  beforeEach(() => { mocked.runtime = null; });

  it("uses a user-scoped worker, stable client message id and routed turn events", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-turn-"));
    const workspace = path.join(userRoot, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { mode: 0o700 }));
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
        roots: { workspace },
      },
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
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "runtime-thread-1",
      clientUserMessageId: userMessageId,
      runtimeWorkspaceRoots: [path.join(workspace, "projects", projectId)],
    });
    expect(JSON.stringify(turnStart?.params)).not.toContain("legacy-must-not-be-used");
    const threadStart = calls.find((call) => call.method === "thread/start");
    expect((threadStart?.params as { dynamicTools?: unknown[] })?.dynamicTools).toEqual([
      expect.objectContaining({
        type: "namespace",
        name: "browser",
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
    expect(events).toContainEqual({ type: "done" });
  });

  it("recovers a completed clientUserMessageId from thread history without starting it twice", async () => {
    const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-worker-recovery-"));
    const workspace = path.join(userRoot, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { mode: 0o700 }));
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
      handle: { roots: { workspace } },
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
      new AbortController().signal,
      async (event) => { events.push(event); },
    );

    expect(calls).toEqual(["thread/resume"]);
    expect(events).toContainEqual({ type: "runtimeTurn", turnId: "runtime-turn-recovered" });
    expect(events).toContainEqual({ type: "content", value: "Recovered answer" });
    expect(events).toContainEqual({ type: "done" });
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
      new AbortController().signal,
      async () => undefined,
    )).rejects.toMatchObject({ code: "MEMORY_TURN_SNAPSHOT_UNAVAILABLE" });
    expect(audited).toBe(false);
    expect(mocked.runtime).toBeNull();
  });
});
