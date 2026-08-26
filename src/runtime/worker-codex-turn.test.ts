import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "@/lib/chat-contract";
import type { ResolvedPermissions } from "@/permissions";

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
}));

import { runWorkerCodexTurn } from "@/runtime/worker-codex-turn";

const installationId = "qa-company";
const userId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000011";
const threadId = "00000000-0000-4000-8000-000000000021";
const userMessageId = "00000000-0000-4000-8000-000000000031";
const assistantMessageId = "00000000-0000-4000-8000-000000000041";
const fingerprint = "a".repeat(64);

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
      async request(method: string, params: unknown, purpose: string) {
        calls.push({ method, params, purpose });
        if (method === "thread/start") return { thread: { id: "runtime-thread-1" } };
        if (method === "turn/start") {
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
          return { turn: { id: "runtime-turn-1" } };
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
      new AbortController().signal,
      (event) => events.push(event),
    );

    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "runtime-thread-1",
      clientUserMessageId: userMessageId,
      runtimeWorkspaceRoots: [path.join(workspace, "projects", projectId)],
    });
    expect(JSON.stringify(turnStart?.params)).not.toContain("legacy-must-not-be-used");
    expect(boundTurn).toBe("runtime-turn-1");
    expect(events).toContainEqual({ type: "runtimeThread", threadToken: "user-bound-runtime-thread-token" });
    expect(events).toContainEqual({ type: "delta", value: "Fet" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
