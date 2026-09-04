import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { ChatMessage } from "@/lib/chat-contract";
import * as chatContract from "@/lib/chat-contract";
import type { AppServerEvent } from "@/runtime/transport";
import { ResourceLockManager } from "@/storage";
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
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("validates a large transcript once per compacted batch, not per delta", async () => {
    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    const thread = "00000000-0000-4000-8000-000000000081";
    const id = "00000000-0000-4000-8000-000000000082";
    const initial = assistant(id);
    initial.content = "History ".repeat(10_000);
    await projections.initialize(thread, initial);
    const validation = vi.spyOn(chatContract, "isChatMessage");
    const events = Array.from({ length: 64 }, (_, index) => ({
      envelope: envelope(index + 1), projectionKey: `delta:${index}`,
      event: { type: "delta" as const, value: "chunk " },
    }));
    const result = await projections.applyTransportEvents(thread, id, events);
    expect(result.projection.message.content).toBe(initial.content + "chunk ".repeat(64));
    expect(validation.mock.calls.length).toBe(3);
  });

  it("rejects masked intermediate snapshot bindings without changing disk or cursor", async () => {
    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    const thread = "00000000-0000-4000-8000-000000000081";
    const id = "00000000-0000-4000-8000-000000000082";
    const initial = assistant(id);
    await projections.initialize(thread, initial);
    for (const patch of [
      { id: "00000000-0000-4000-8000-000000000083" },
      { role: "user" as const },
      { createdAt: "2026-08-28T00:00:00.001Z" },
      { createdAt: "2026-08-27T00:00:00.001+00:00" },
    ]) {
      const before = await projections.read(thread, id);
      await expect(projections.applyTransportEvents(thread, id, [
        { envelope: envelope(1), projectionKey: "delta", event: { type: "delta", value: "valid" } },
        { envelope: envelope(2), projectionKey: "snapshot", event: { type: "snapshot", message: { ...initial, ...patch } } },
        { envelope: envelope(3), projectionKey: "restore", event: { type: "snapshot", message: initial } },
      ])).rejects.toThrow();
      expect(await projections.read(thread, id)).toEqual(before);
      await expect(projections.applyLocalEvent(thread, id,
        { type: "snapshot", message: { ...initial, ...patch } })).rejects.toThrow();
      expect(await projections.read(thread, id)).toEqual(before);
    }
    const valid = await projections.applyTransportEvents(thread, id, [
      { envelope: envelope(1), projectionKey: "snapshot", event: { type: "snapshot", message: { ...initial, content: "valid" } } },
    ]);
    expect(valid.projection.lastTransportSequence).toBe(1);
    expect(valid.projection.message.content).toBe("valid");
  });

  it("rejects malformed intermediate envelopes and oversized key sets without partial persistence", async () => {
    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    const thread = "00000000-0000-4000-8000-000000000081";
    const id = "00000000-0000-4000-8000-000000000082";
    await projections.initialize(thread, assistant(id));
    const events = Array.from({ length: 33 }, (_, index) => ({ envelope: envelope(1),
      projectionKey: `delta:${index}`, event: { type: "delta" as const, value: "chunk " } }));
    await expect(projections.applyTransportEvents(thread, id, events)).rejects.toThrow(/límit/u);
    await expect(projections.applyTransportEvents(thread, id, [
      { ...events[0], envelope: envelope(0.5) }, { ...events[1], envelope: envelope(2) },
    ])).rejects.toThrow(/vàlid/u);
    expect((await projections.read(thread, id))?.message.content).toBe("");
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
    await projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1),
      "source:official",
      { type: "source", item: {
        id: "source-official", kind: "web", title: "Fuente oficial",
        url: "https://example.com/oficial", domain: "example.com", snippet: "Dato verificable",
        publishedAt: null,
      } },
    );
    await projections.applyTransportEvent(
      thread.id,
      assistantId,
      envelope(1),
      "tool-result:search",
      { type: "toolResult", item: {
        id: "search-1", kind: "web", title: "Búsqueda oficial", status: "complete",
        summary: "1 fuente", output: null, sourceIds: ["source-official"],
        createdAt: "2026-08-27T00:00:01.000Z",
      } },
    );
    await projections.setRuntimeThreadToken(thread.id, assistantId, "signed-runtime-token");
    await projections.setRuntimeTurnId(thread.id, assistantId, "runtime-turn-1");

    const restarted = new FileWorkbenchStore({ installationId, usersRoot });
    const recovered = await restarted.getThread(userId, thread.id);
    expect(recovered.messages.at(-1)).toMatchObject({
      id: assistantId,
      content: "Hello",
      status: "complete",
      sources: [{ id: "source-official", url: "https://example.com/oficial" }],
      toolResults: [{ id: "search-1", sourceIds: ["source-official"] }],
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

  it("compacts ordered streaming deltas into one durable projection batch", async () => {
    const workbench = new FileWorkbenchStore({ installationId, usersRoot });
    const project = await workbench.createProject(userId, "Streaming");
    const thread = await workbench.createThread(userId, project.id, "Fast stream");
    const assistantId = "00000000-0000-4000-8000-000000000022";
    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    await projections.initialize(thread.id, assistant(assistantId));

    const batch = [
      { envelope: envelope(1), projectionKey: "delta:one", event: { type: "delta" as const, value: "Uno " } },
      { envelope: envelope(2), projectionKey: "delta:two", event: { type: "delta" as const, value: "dos " } },
      { envelope: envelope(3), projectionKey: "delta:three", event: { type: "delta" as const, value: "tres." } },
      { envelope: envelope(3), projectionKey: "turn:done", event: { type: "done" as const } },
    ];
    const first = await projections.applyTransportEvents(thread.id, assistantId, batch);
    expect(first.applied).toEqual([true, true, true, true]);
    expect(first.projection.message).toMatchObject({ content: "Uno dos tres.", status: "complete" });

    const replay = await projections.applyTransportEvents(thread.id, assistantId, batch);
    expect(replay.applied).toEqual([false, false, false, false]);
    expect(replay.projection.message.content).toBe("Uno dos tres.");
  });

  it("does not hold the global workbench lock while a turn projection is contended", async () => {
    const workbench = new FileWorkbenchStore({ installationId, usersRoot });
    const project = await workbench.createProject(userId, "Concurrent");
    const thread = await workbench.createThread(userId, project.id, "Blocked projection");
    const assistantId = "00000000-0000-4000-8000-000000000032";
    await workbench.beginThreadTurn(
      userId,
      thread.id,
      userMessage("00000000-0000-4000-8000-000000000031"),
      assistant(assistantId),
    );

    const projections = new FileTurnProjectionStore({ installationId, userId, usersRoot });
    await projections.initialize(thread.id, assistant(assistantId));
    const locks = new ResourceLockManager({
      rootDirectory: path.join(usersRoot, userId, "state", ".locks"),
    });
    const lease = await locks.acquire(
      `turn-projection:${installationId}:${userId}:${thread.id}:${assistantId}`,
    );

    try {
      const concurrentOperations = Promise.all([
        workbench.getThread(userId, thread.id),
        workbench.createProject(userId, "Independent"),
      ]);
      await expect(Promise.race([
        concurrentOperations,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("projection contention blocked the workbench")),
          1_000,
        )),
      ])).resolves.toEqual([
        expect.objectContaining({ id: thread.id }),
        expect.objectContaining({ name: "Independent" }),
      ]);
    } finally {
      await lease.release();
    }
  });
});
