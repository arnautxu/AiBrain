import { describe, expect, it, vi } from "vitest";
import { isTurnControlRequest, type TurnControlRequest } from "@/lib/chat-contract";

const mocked = vi.hoisted(() => ({ cancel: vi.fn(() => true) }));
vi.mock("server-only", () => ({}));
vi.mock("@/runtime/worker-runtime-service", () => ({
  cancelWorkerTurnLocally: mocked.cancel,
  workerAppServerForUser: vi.fn(),
}));

import { executeTurnControl, TurnControlError } from "@/runtime/turn-control";

const identity = {
  installationId: "qa-company",
  userId: "00000000-0000-4000-8000-000000000001",
  runtimeThreadId: "runtime-thread-1",
  runtimeTurnId: "runtime-turn-1",
};
const assistantMessageId = "00000000-0000-4000-8000-000000000041";
const clientRequestId = "00000000-0000-4000-8000-000000000051";
const userMessageId = "00000000-0000-4000-8000-000000000061";

describe("turn control", () => {
  it("validates strict, bounded UI control contracts", () => {
    expect(isTurnControlRequest({
      action: "stop",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
    })).toBe(true);
    expect(isTurnControlRequest({
      action: "steer",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
      userMessageId,
      message: "Comprova també el risc contractual.",
    })).toBe(true);
    expect(isTurnControlRequest({
      action: "stop",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
      runtimeTurnId: "attacker-selected",
    })).toBe(false);
    expect(isTurnControlRequest({
      action: "steer",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
      userMessageId,
      message: "\0",
    })).toBe(false);
  });

  it("steers only the expected active runtime turn and persists before resolving", async () => {
    const persisted: unknown[] = [];
    const request = vi.fn(async (
      method: string,
      params: unknown,
      purpose: string,
      _timeout: number,
      beforeResolve: (value: unknown) => Promise<void>,
    ) => {
      expect(method).toBe("turn/steer");
      expect(params).toEqual({
        threadId: identity.runtimeThreadId,
        expectedTurnId: identity.runtimeTurnId,
        clientUserMessageId: userMessageId,
        input: [{
          type: "text",
          text: "Comprova també el risc contractual.",
          text_elements: [],
        }],
      });
      expect(purpose).toBe(`turn-steer:${clientRequestId}`);
      await beforeResolve({ turnId: identity.runtimeTurnId });
      expect(persisted).toHaveLength(1);
      return { turnId: identity.runtimeTurnId };
    });
    const control: TurnControlRequest = {
      action: "steer",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
      userMessageId,
      message: "  Comprova també el risc contractual.  ",
    };
    await expect(executeTurnControl(
      { request } as never,
      identity,
      control,
      async (event) => { persisted.push(event); },
    )).resolves.toEqual({ action: "steer", runtimeTurnId: identity.runtimeTurnId });
    expect(persisted).toMatchObject([{ type: "activity", item: { id: `steer:${clientRequestId}` } }]);
  });

  it("persists a confirmed stop, then cancels local approval waiters", async () => {
    mocked.cancel.mockClear();
    const persisted: unknown[] = [];
    const request = vi.fn(async (
      method: string,
      params: unknown,
      purpose: string,
      _timeout: number,
      beforeResolve: (value: unknown) => Promise<void>,
    ) => {
      expect(method).toBe("turn/interrupt");
      expect(params).toEqual({
        threadId: identity.runtimeThreadId,
        turnId: identity.runtimeTurnId,
      });
      expect(purpose).toBe(`turn-interrupt:${clientRequestId}`);
      await beforeResolve({});
      return {};
    });
    const control: TurnControlRequest = {
      action: "stop",
      threadId: "00000000-0000-4000-8000-000000000021",
      assistantMessageId,
      clientRequestId,
    };
    await expect(executeTurnControl(
      { request } as never,
      identity,
      control,
      async (event) => { persisted.push(event); },
    )).resolves.toEqual({
      action: "stop",
      runtimeTurnId: identity.runtimeTurnId,
      activeRunnerCancelled: true,
    });
    expect(persisted).toMatchObject([
      { type: "activity", item: { id: `stop:${clientRequestId}`, status: "stopped" } },
      { type: "stopped" },
    ]);
    expect(mocked.cancel).toHaveBeenCalledWith(
      identity.userId,
      identity.runtimeThreadId,
      assistantMessageId,
    );
  });

  it("rejects an inconsistent steer response", async () => {
    const request = vi.fn(async (
      _method: string,
      _params: unknown,
      _purpose: string,
      _timeout: number,
      beforeResolve: (value: unknown) => Promise<void>,
    ) => {
      await beforeResolve({ turnId: "runtime-turn-other" });
      return { turnId: "runtime-turn-other" };
    });
    await expect(executeTurnControl(
      { request } as never,
      identity,
      {
        action: "steer",
        threadId: "00000000-0000-4000-8000-000000000021",
        assistantMessageId,
        clientRequestId,
        userMessageId,
        message: "Una indicació",
      },
      async () => undefined,
    )).rejects.toBeInstanceOf(TurnControlError);
  });
});
