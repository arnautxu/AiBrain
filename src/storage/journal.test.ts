import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileJournal } from "@/storage/journal";
import { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectString,
} from "@/storage/schema";

type TestEvent = { schemaVersion: 1; label: string };

const eventSchema = defineVersionedSchema<TestEvent>({
  name: "TestJournalEvent",
  schemaVersion: 1,
  keys: ["label"],
  parse(record, context) {
    return {
      schemaVersion: 1,
      label: expectString(record.label, context.at("label"), { minLength: 1, maxLength: 80 }),
    };
  },
});

describe("append-only file journal", () => {
  let root: string;
  let journalPath: string;
  let lockManager: ResourceLockManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aibrain-journal-"));
    journalPath = path.join(root, "turns", "turn-1.jsonl");
    lockManager = new ResourceLockManager({
      rootDirectory: path.join(root, "locks"),
      staleAfterMs: 2_000,
      heartbeatIntervalMs: 100,
      retryDelayMs: 1,
      maxRetryDelayMs: 5,
      jitterRatio: 0,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function journal(manager = lockManager) {
    return new FileJournal({
      filePath: journalPath,
      lockManager: manager,
      payloadSchema: eventSchema,
    });
  }

  it("appends strictly increasing durable sequences and paginates replay", async () => {
    const events = journal();
    const first = await events.append({ schemaVersion: 1, label: "one" });
    const second = await events.append({ schemaVersion: 1, label: "two" });
    const third = await events.append({ schemaVersion: 1, label: "three" });

    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3]);
    expect(new Set([first.eventId, second.eventId, third.eventId]).size).toBe(3);
    expect((await events.read({ afterSequence: 1, limit: 1 }))[0]?.payload.label).toBe("two");
    expect((await events.verifyAndRepair())).toEqual({
      count: 3,
      lastSequence: 3,
      repairedBytes: 0,
    });
  });

  it("serializes concurrent appenders without gaps or duplicates", async () => {
    const secondManager = new ResourceLockManager({
      rootDirectory: path.join(root, "locks"),
      staleAfterMs: 2_000,
      heartbeatIntervalMs: 100,
      retryDelayMs: 1,
      maxRetryDelayMs: 5,
      jitterRatio: 0,
    });
    const journals = [journal(), journal(secondManager)];
    const appended = await Promise.all(Array.from({ length: 60 }, (_, index) =>
      journals[index % journals.length].append({ schemaVersion: 1, label: `event-${index}` })));

    const replay = await journals[0].read();
    expect(replay.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 1),
    );
    expect(new Set(replay.map((entry) => entry.eventId)).size).toBe(60);
    expect(new Set(appended.map((entry) => entry.payload.label)).size).toBe(60);
  });

  it("supports an atomic conditional append under the journal lock", async () => {
    const events = journal();
    const first = await events.appendIf(
      { schemaVersion: 1, label: "unique" },
      (entries) => !entries.some((entry) => entry.payload.label === "unique"),
    );
    const duplicate = await events.appendIf(
      { schemaVersion: 1, label: "unique" },
      (entries) => !entries.some((entry) => entry.payload.label === "unique"),
    );

    expect(first?.sequence).toBe(1);
    expect(duplicate).toBeNull();
    expect(await events.read()).toHaveLength(1);
  });

  it("truncates only a torn final record and continues at the next sequence", async () => {
    const events = journal();
    await events.append({ schemaVersion: 1, label: "committed" });
    const committedLength = (await readFile(journalPath)).length;
    await writeFile(journalPath, "{\"schemaVersion\":1", { flag: "a" });

    const repair = await events.verifyAndRepair();
    expect(repair).toMatchObject({ count: 1, lastSequence: 1 });
    expect(repair.repairedBytes).toBeGreaterThan(0);
    expect((await readFile(journalPath)).length).toBe(committedLength);

    const next = await events.append({ schemaVersion: 1, label: "after-restart" });
    expect(next.sequence).toBe(2);
    expect((await events.read()).map((entry) => entry.payload.label))
      .toEqual(["committed", "after-restart"]);
  });

  it("fails closed for a corrupt complete record instead of dropping history", async () => {
    const events = journal();
    await events.append({ schemaVersion: 1, label: "committed" });
    await writeFile(journalPath, "not-json\n", { flag: "a" });
    const before = await readFile(journalPath, "utf8");

    await expect(events.verifyAndRepair()).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    expect(await readFile(journalPath, "utf8")).toBe(before);
  });

  it("detects sequence gaps", async () => {
    const malformed = {
      schemaVersion: 1,
      sequence: 2,
      eventId: "00000000-0000-4000-8000-000000000000",
      recordedAt: new Date(0).toISOString(),
      payload: { schemaVersion: 1, label: "gap" },
    };
    await mkdir(path.dirname(journalPath), { recursive: true });
    await writeFile(journalPath, `${JSON.stringify(malformed)}\n`);

    await expect(journal().read()).rejects.toThrow(/expected sequence 1, found 2/);
  });

  it("rejects journal symlinks", async () => {
    const outside = path.join(root, "outside.jsonl");
    await writeFile(outside, "");
    await mkdir(path.dirname(journalPath), { recursive: true });
    await symlink(outside, journalPath);

    await expect(journal().append({ schemaVersion: 1, label: "blocked" }))
      .rejects.toMatchObject({ code: "STORAGE_SYMLINK_REJECTED" });
    expect(await readFile(outside, "utf8")).toBe("");
  });
});
