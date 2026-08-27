import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { ChatMessage } from "@/lib/chat-contract";
import type { AppServerEvent } from "@/runtime/transport";
import { FileWorkbenchStore } from "@/workbench/filesystem-store";
import { FileTurnProjectionStore } from "@/workbench/turn-projection-store";

const installationId = "qa-company";
const userId = "00000000-0000-4000-8000-000000000001";

function assistant(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: "2026-08-27T00:00:00.001Z",
    status: "streaming",
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    attachments: [],
    artifacts: [],
  };
}

function userMessage(id: string): ChatMessage {
  return { ...assistant(id), role: "user", content: "Hello", status: "complete" };
}

function envelope(sequence: number, eventId = `event-${sequence}`): AppServerEvent {
  return {
    eventId,
    sequence,
    occurredAt: "2026-08-27T00:00:01.000Z",
    message: {
      kind: "rpc-notification",
      rpc: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "runtime-thread",
          turnId: "runtime-turn",
          itemId: "runtime-item",
          delta: "Hello",
        },
      },
    },
  };
}

describe("turn projection store", () => {
  let root: string;
  let usersRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aibrain-turn-projection-"));
    usersRoot = path.join(root, "users");
    await mkdir(path.join(usersRoot, userId), { recursive: true, mode: 0o700 });
    await chmod(usersRoot, 0o700);
    await chmod(path.join(usersRoot, userId), 0o700);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("projects transport events exactly once and recovers message plus runtime token", async () => {
    const workbench = new FileWorkbenchStore({ installationId, usersRoot });
    const project = await workbench.createProject(userId, "Project");
    const thread = await workbench.createThread(userId, project.id, "Thread");
    const userIdMessage = "00000000-0000-4000-8000-000000000011";
    const assistantId = "00000000-0000-4000-8000-000000000012";
    await workbench.beginThreadTurn(
      userId,
      thread.id,
      userMessage(userIdMessage),
      assistant(assistantId),
    );

    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    await projections.initialize(thread.id, assistant(assistantId));
    await projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1),
      "delta:runtime-item",
      { type: "delta", value: "Hello" },
    );
    await projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1),
      "delta:runtime-item",
      { type: "delta", value: "Hello" },
    );
    await projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1),
      "turn:done",
      { type: "done" },
    );
    await projections.setRuntimeThreadToken(thread.id, assistantId, "signed-runtime-token");
    await projections.setRuntimeTurnId(thread.id, assistantId, "runtime-turn-1");

    const restarted = new FileWorkbenchStore({ installationId, usersRoot });
    const recovered = await restarted.getThread(userId, thread.id);
    expect(recovered.messages.at(-1)).toMatchObject({
      id: assistantId,
      content: "Hello",
      status: "complete",
    });
    expect((await restarted.getThreadRuntimeContext(userId, thread.id)).runtimeThreadToken)
      .toBe("signed-runtime-token");
    expect((await projections.read(thread.id, assistantId))?.runtimeTurnId).toBe("runtime-turn-1");
    await expect(projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1, "different-event"),
      "other",
      { type: "delta", value: "blocked" },
    )).rejects.toThrow("seqüència");
  });
});
