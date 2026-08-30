import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import type { DynamicToolCallParams } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { JsonValue } from "../../contracts/codex/0.149.1/types/serde_json/JsonValue";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000001",
  sourceThreadId: "20000000-0000-4000-8000-000000000001",
  project: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Conversaciones",
    slug: "aibrain-standalone-chats",
    status: "active" as const,
  },
  createAutomationTask: vi.fn(),
}));

vi.mock("@/automations/server-service", () => ({
  automationWorkspaceForSession: vi.fn(async () => ({ installation: {}, users: [], state: {}, principal: {}, isAdmin: false })),
  createAutomationTask: mocks.createAutomationTask,
  listAutomationTasks: vi.fn(async () => ({
    tasks: [],
    directory: {
      membershipPolicy: "current" as const,
      currentUserId: mocks.userId,
      users: [{ id: mocks.userId, name: "David" }],
      groups: [],
    },
  })),
  validateAutomationAudience: vi.fn((audience) => audience),
}));

vi.mock("@/workbench/store", () => ({
  getProject: vi.fn(async () => mocks.project),
  loadWorkbench: vi.fn(async () => ({ projects: [mocks.project] })),
}));

import {
  AIBRAIN_AUTOMATION_TOOL_NAMESPACE,
  automationChatDeveloperInstructions,
  handleAutomationToolCall,
  needsAutomationChatTools,
} from "@/automations/chat-tools";

const session: AuthSession = {
  provider: "local",
  user: { id: mocks.userId, name: "David", email: "david@example.test" },
  tenant: { id: "automation-qa", name: "Automation QA" },
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function toolCall(tool: "propose" | "confirm", turnId: string, args: JsonValue): DynamicToolCallParams {
  return {
    threadId: "runtime-thread",
    turnId,
    callId: `call-${turnId}`,
    namespace: AIBRAIN_AUTOMATION_TOOL_NAMESPACE,
    tool,
    arguments: args,
  };
}

beforeEach(() => {
  mocks.createAutomationTask.mockReset();
  mocks.createAutomationTask.mockImplementation(async (_session, _input, options: { taskId: string }) => ({ id: options.taskId }));
});

describe("automation chat creation", () => {
  it("detects scheduling turns that need a fresh dynamic-tool thread", () => {
    expect(needsAutomationChatTools("Envíame hello dentro de 2 minutos")).toBe(true);
    expect(needsAutomationChatTools("Cada lunes revisa @gmail y prepara un resumen")).toBe(true);
    expect(needsAutomationChatTools("Confirmo, créala")).toBe(true);
    expect(needsAutomationChatTools("Sí, esa conclusión es correcta")).toBe(false);
    expect(needsAutomationChatTools("Resume la conversación anterior")).toBe(false);
  });

  it("gives natural relative instructions safe current-user defaults", async () => {
    const instructions = await automationChatDeveloperInstructions(session, {
      projectId: mocks.projectId,
      currentTime: new Date("2030-08-30T08:00:00.000Z"),
      timeZone: "Europe/Madrid",
    });

    expect(instructions).toContain("envíame hello dentro de 2 minutos");
    expect(instructions).toContain("no pidas aclaraciones por esos campos");
    expect(instructions).toContain("menciones @");
    expect(instructions).toContain('"projectName":"Sin proyecto"');
    expect(instructions).toContain('"currentTime":"2030-08-30T08:00:00.000Z"');
    expect(instructions).toContain(`"userIds":["${mocks.userId}"]`);
  });

  it("confirms the latest durable proposal from a later natural yes without repeating its id", async () => {
    const usersRoot = await mkdtemp(path.join(os.tmpdir(), "aibrain-chat-confirm-"));
    const base = {
      session,
      sourceThreadId: mocks.sourceThreadId,
      sourceMessage: "Envíame hello dentro de 2 minutos",
      runtimeThreadId: "runtime-thread",
      usersRoot,
    };
    const proposed = await handleAutomationToolCall(toolCall("propose", "runtime-turn-one", {
      name: "Hello",
      prompt: "Envía hello como resultado de esta automatización.",
      projectId: mocks.projectId,
      timeZone: "Europe/Madrid",
      schedule: { kind: "once", runAt: "2030-08-30T08:02:00.000Z" },
      audience: { membershipPolicy: "current", userIds: [mocks.userId], groupIds: [] },
    }), {
      ...base,
      sourceTurnId: "30000000-0000-4000-8000-000000000001",
      runtimeTurnId: "runtime-turn-one",
    });
    expect(proposed.success).toBe(true);

    const confirmed = await handleAutomationToolCall(toolCall("confirm", "runtime-turn-two", {}), {
      ...base,
      sourceMessage: "Sí, adelante",
      sourceTurnId: "30000000-0000-4000-8000-000000000002",
      runtimeTurnId: "runtime-turn-two",
    });
    const replay = await handleAutomationToolCall(toolCall("confirm", "runtime-turn-three", {}), {
      ...base,
      sourceMessage: "Confirmo",
      sourceTurnId: "30000000-0000-4000-8000-000000000003",
      runtimeTurnId: "runtime-turn-three",
    });

    expect(confirmed.success).toBe(true);
    expect(replay.success).toBe(true);
    expect(mocks.createAutomationTask).toHaveBeenCalledTimes(1);
  });
});
