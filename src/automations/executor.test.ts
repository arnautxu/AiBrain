import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import type { InstallationConfig } from "@/config/installation-schema";
import { DEFAULT_AUTOMATION_EXECUTION_CONTEXT, type AutomationTask } from "@/automations/contracts";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  runWorkerCodexTurn: vi.fn(),
  finishThreadTurn: vi.fn(),
  getThread: vi.fn(),
  beginThreadTurn: vi.fn(),
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/runtime/worker-codex-turn", () => ({ runWorkerCodexTurn: mocks.runWorkerCodexTurn }));
vi.mock("@/runtime/config", () => ({
  readRuntimeConfig: () => ({ mode: "codex", approvalPolicy: "never", sandbox: "workspace-write" }),
}));
vi.mock("@/runtime/approval-store", () => ({ FileApprovalStore: class {} }));
vi.mock("@/memory", () => ({ LocalFileMemoryService: class {} }));
vi.mock("@/runtime/memory-turn", () => ({ FileMemoryTurnAuditSink: class {} }));
vi.mock("@/runtime/permission-turn", () => ({ resolveServerTurnPermissions: vi.fn(async () => ({})) }));
vi.mock("@/automations/audience-store", () => ({ FileAutomationAudienceStore: class { async record() {} } }));
vi.mock("@/connectors/mentions", () => ({
  authorizedConnectorMentionIdsForTurn: vi.fn(async () => ["gmail", "attio"]),
}));
vi.mock("@/settings/server-service", () => ({
  featurePolicyForIdentity: vi.fn(async () => ({ "web-search": true, skills: true })),
}));
vi.mock("@/workbench/store", () => ({
  createThread: vi.fn(async () => ({ id: "30000000-0000-4000-8000-000000000001" })),
  getThreadRuntimeContext: vi.fn(async () => ({
    projectId: "20000000-0000-4000-8000-000000000001",
    workspaceKey: "workspace",
    projectName: "Operaciones",
    projectInstructions: "",
    projectMemory: "",
    projectSources: [],
    visibleProjects: [],
    branchHistory: null,
  })),
  beginThreadTurn: mocks.beginThreadTurn,
  getThread: mocks.getThread,
  finishThreadTurn: mocks.finishThreadTurn,
}));

import { executeScheduledTurn } from "@/automations/executor";

const session: AuthSession = {
  provider: "local",
  user: { id: "00000000-0000-4000-8000-000000000001", name: "David", email: "david@example.test" },
  tenant: { id: "automation-qa", name: "Automation QA" },
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const installation = {
  installationId: "automation-qa",
  companyName: "Automation QA",
  branding: { productName: "AiBrain" },
  paths: { dataRoot: "/tmp/aibrain-executor-data", usersRoot: "/tmp/aibrain-executor-users" },
} as unknown as Readonly<InstallationConfig>;

const task: AutomationTask = {
  schemaVersion: 1,
  id: "10000000-0000-4000-8000-000000000001",
  installationId: installation.installationId,
  userId: session.user.id,
  audience: { membershipPolicy: "current", userIds: [session.user.id], groupIds: [] },
  name: "Hello",
  prompt: "Usa @gmail y la skill autorizada para preparar hello.",
  projectId: "20000000-0000-4000-8000-000000000001",
  projectName: "Operaciones",
  timeZone: "Europe/Madrid",
  schedule: { kind: "once", runAt: "2030-08-30T08:02:00.000Z" },
  executionContext: DEFAULT_AUTOMATION_EXECUTION_CONTEXT,
  state: "active",
  nextRunAt: "2030-08-30T08:02:00.000Z",
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  retryAt: null,
  manualRun: null,
  deletedAt: null,
  cancellationRequestedAt: null,
  lease: null,
  createdAt: "2030-08-30T08:00:00.000Z",
  updatedAt: "2030-08-30T08:00:00.000Z",
};

beforeEach(() => {
  mocks.messages = [];
  mocks.runWorkerCodexTurn.mockReset();
  mocks.finishThreadTurn.mockClear();
  mocks.getThread.mockReset();
  mocks.getThread.mockImplementation(async () => ({ messages: mocks.messages }));
  mocks.beginThreadTurn.mockReset();
  mocks.beginThreadTurn.mockImplementation(async (_session, _threadId, userMessage, assistantMessage) => {
    mocks.messages = [userMessage, assistantMessage];
    return { outcome: "created", assistantMessage };
  });
  mocks.finishThreadTurn.mockImplementation(async (_session, _threadId, assistantMessage) => {
    mocks.messages = [mocks.messages[0]!, assistantMessage];
  });
  mocks.runWorkerCodexTurn.mockImplementation(async (...args: unknown[]) => {
    const emit = args[10] as (event: unknown) => Promise<void>;
    await emit({ type: "content", value: "TEST-AUTO-P0-OK" });
    await emit({ type: "done" });
  });
});

describe("scheduled automation execution", () => {
  it("runs without a browser session with live web, current skills and authorized @ connectors", async () => {
    await expect(executeScheduledTurn({
      installation,
      session,
      task,
      runKey: `${task.id}:${task.nextRunAt}`,
    })).resolves.toEqual({ threadId: "30000000-0000-4000-8000-000000000001" });

    const call = mocks.runWorkerCodexTurn.mock.calls[0];
    expect(call?.[0]).toMatchObject({
      message: task.prompt,
      options: {
        webSearch: true,
        inheritAuthorizedSkills: true,
        connectorMentions: ["gmail", "attio"],
        attachments: [],
      },
    });
    expect(call?.[16]).toBeUndefined();
    expect(call?.[17]).toBe(session);
    expect(call?.[18]).toBe(true);
    expect(mocks.finishThreadTurn).toHaveBeenCalledOnce();
    expect(mocks.messages).toEqual([
      expect.objectContaining({ role: "user", content: task.prompt }),
      expect.objectContaining({ role: "assistant", status: "complete", content: "TEST-AUTO-P0-OK" }),
    ]);
  });

  it("does not mark an occurrence successful when the result conversation is empty", async () => {
    mocks.runWorkerCodexTurn.mockImplementationOnce(async (...args: unknown[]) => {
      const emit = args[10] as (event: unknown) => Promise<void>;
      await emit({ type: "done" });
    });

    await expect(executeScheduledTurn({
      installation,
      session,
      task,
      runKey: `${task.id}:${task.nextRunAt}:empty`,
    })).rejects.toThrow("sin un resultado visible");
  });

  it("requires prompt and terminal content to survive durable thread readback", async () => {
    mocks.getThread.mockResolvedValueOnce({ messages: [] });
    await expect(executeScheduledTurn({
      installation,
      session,
      task,
      runKey: `${task.id}:${task.nextRunAt}:readback`,
    })).rejects.toThrow("no conserva el prompt y el resultado terminal");
  });

  it("rejects an empty terminal result recovered after a worker restart", async () => {
    mocks.beginThreadTurn.mockImplementationOnce(async (_session, _threadId, userMessage, assistantMessage) => {
      const empty = { ...assistantMessage, status: "complete" };
      mocks.messages = [userMessage, empty];
      return { outcome: "existing", assistantMessage: empty };
    });
    await expect(executeScheduledTurn({
      installation,
      session,
      task,
      runKey: `${task.id}:${task.nextRunAt}:recovered-empty`,
      existingThreadId: "30000000-0000-4000-8000-000000000001",
    })).rejects.toThrow("sin un resultado visible");
    expect(mocks.runWorkerCodexTurn).not.toHaveBeenCalled();
  });
});
