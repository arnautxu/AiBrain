import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppServerEvent } from "@/runtime/transport/contracts";
import { FileTransportEventJournal } from "@/runtime/transport/file-event-journal";
import { ResourceLockManager } from "@/storage/resource-lock";

const roots: string[] = [];

async function createJournal() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-transport-journal-"));
  roots.push(root);
  return new FileTransportEventJournal({
    filePath: path.join(root, "transport", "events.jsonl"),
    lockManager: new ResourceLockManager({ rootDirectory: path.join(root, "locks") }),
  });
}

function event(sequence: number, eventId = `event-${sequence}`): AppServerEvent {
  return {
    eventId,
    sequence,
    occurredAt: "2026-08-27T00:00:00.000Z",
    message: {
      kind: "rpc-notification",
      rpc: { method: "warning", params: { threadId: null, message: `event ${sequence}` } },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file transport event journal", () => {
  it("persists a replay cursor across instances and dedupes exact events", async () => {
    const journal = await createJournal();
    expect(await journal.loadCursor()).toBeNull();
    expect(await journal.append(event(1))).toBe(true);
    expect(await journal.append(event(1))).toBe(false);
    expect(await journal.append(event(2))).toBe(true);
    expect(await journal.loadCursor()).toEqual({ eventId: "event-2", sequence: 2 });
    expect(await journal.verifyAndRepair()).toMatchObject({ count: 2, lastSequence: 2 });
  });

  it("fails closed for gaps and event id reuse", async () => {
    const journal = await createJournal();
    await expect(journal.append(event(2))).rejects.toThrow("expected sequence 1");
    await journal.append(event(1, "stable-id"));
    await expect(journal.append(event(2, "stable-id"))).rejects.toThrow("different sequence");
  });
});
