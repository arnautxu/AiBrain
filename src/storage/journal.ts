import { constants, type BigIntStats } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, fsyncDirectory } from "@/storage/atomic-file";
import { StorageCorruptionError, StorageError } from "@/storage/errors";
import { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectInteger,
  expectIsoDate,
  expectString,
  parseJson,
  type StorageSchema,
} from "@/storage/schema";

export type JournalEntry<Payload> = {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  recordedAt: string;
  payload: Payload;
};

export type FileJournalOptions<Payload> = {
  filePath: string;
  lockManager: ResourceLockManager;
  payloadSchema: StorageSchema<Payload>;
  now?: () => number;
  contiguousPayloadSequence?: (payload: Payload) => number;
};

export type JournalReadOptions = {
  afterSequence?: number;
  limit?: number;
};

type AppendJob<Payload> = {
  payload: Payload;
  resolve: (entry: JournalEntry<Payload>) => void;
  reject: (error: unknown) => void;
};

// Cache only validated snapshots, scoped to the journal instance (including its
// schema). The process-wide LRU bounds both retained payloads and offset indexes.
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_ENTRIES = 65_536;
type JournalSnapshot<Payload> = {
  fingerprint: string;
  offsets: number[];
  count: number;
  bytes: number;
  entries?: JournalEntry<Payload>[];
  weight: number;
  contiguousSequenceOffset?: number;
};
const snapshots = new Map<object, JournalSnapshot<unknown>>();
let snapshotBytes = 0;

function fingerprint(stat: BigIntStats) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function createJournalEntrySchema<Payload>(payloadSchema: StorageSchema<Payload>) {
  return defineVersionedSchema<JournalEntry<Payload>>({
    name: `JournalEntry<${payloadSchema.name}>`,
    schemaVersion: 1,
    keys: ["sequence", "eventId", "recordedAt", "payload"],
    parse(record, context) {
      return {
        schemaVersion: 1,
        sequence: expectInteger(record.sequence, context.at("sequence"), { minimum: 1 }),
        eventId: expectString(record.eventId, context.at("eventId"), {
          minLength: 36,
          maxLength: 36,
          pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        }),
        recordedAt: expectIsoDate(record.recordedAt, context.at("recordedAt")),
        payload: payloadSchema.parse(record.payload, `${context.source}${context.at("payload").path}`),
      };
    },
  });
}

export class FileJournal<Payload> {
  readonly filePath: string;
  private readonly lockManager: ResourceLockManager;
  private readonly payloadSchema: StorageSchema<Payload>;
  private readonly entrySchema: StorageSchema<JournalEntry<Payload>>;
  private readonly now: () => number;
  private readonly contiguousPayloadSequence?: (payload: Payload) => number;
  private readonly appendQueue: AppendJob<Payload>[] = [];
  private appendScheduled = false;
  private appendDraining = false;

  constructor(options: FileJournalOptions<Payload>) {
    if (!path.isAbsolute(options.filePath)) {
      throw new StorageError(
        "STORAGE_JOURNAL_OPTIONS_INVALID",
        "Journal filePath must be absolute.",
      );
    }
    this.filePath = path.resolve(options.filePath);
    this.lockManager = options.lockManager;
    this.payloadSchema = options.payloadSchema;
    this.entrySchema = createJournalEntrySchema(options.payloadSchema);
    this.now = options.now ?? Date.now;
    this.contiguousPayloadSequence = options.contiguousPayloadSequence;
  }

  private lockKey() {
    return `journal:${this.filePath}`;
  }

  private async assertNotSymlink() {
    try {
      if ((await lstat(this.filePath)).isSymbolicLink()) {
        throw new StorageError(
          "STORAGE_SYMLINK_REJECTED",
          `Refusing to open journal symbolic link ${this.filePath}.`,
        );
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  private forgetSnapshot() {
    const old = snapshots.get(this);
    if (old) snapshotBytes -= old.weight;
    snapshots.delete(this);
  }

  private rememberSnapshot(snapshot: JournalSnapshot<Payload>) {
    this.forgetSnapshot();
    snapshots.set(this, snapshot as JournalSnapshot<unknown>);
    snapshotBytes += snapshot.weight;
    while (snapshotBytes > MAX_CACHE_BYTES || snapshots.size > 128) {
      const oldest = snapshots.keys().next().value;
      if (oldest === undefined) break;
      snapshotBytes -= snapshots.get(oldest)!.weight;
      snapshots.delete(oldest);
    }
  }

  private parseEntry(line: string, expectedSequence: number) {
    if (line.length === 0) {
      throw new StorageCorruptionError(this.filePath, `empty journal record at sequence ${expectedSequence}`);
    }
    let entry: JournalEntry<Payload>;
    try {
      entry = parseJson(this.entrySchema, line, `${this.filePath}:${expectedSequence}`);
    } catch (error) {
      throw new StorageCorruptionError(this.filePath,
        `invalid complete journal record at sequence ${expectedSequence}`, { cause: error });
    }
    if (entry.sequence !== expectedSequence) {
      throw new StorageCorruptionError(this.filePath,
        `expected sequence ${expectedSequence}, found ${entry.sequence}`);
    }
    return entry;
  }

  private validateContiguousSequence(entry: JournalEntry<Payload>, offset?: number) {
    if (!this.contiguousPayloadSequence) return undefined;
    const sequence = this.contiguousPayloadSequence(entry.payload);
    if (!Number.isSafeInteger(sequence) || sequence < 1 ||
        (offset !== undefined && sequence !== entry.sequence + offset)) {
      throw new StorageCorruptionError(this.filePath, "non-contiguous payload sequence");
    }
    return offset ?? sequence - entry.sequence;
  }

  private async readUnlocked(repairIncompleteTail: boolean, options: JournalReadOptions = {}) {
    const after = options.afterSequence ?? 0;
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      this.forgetSnapshot();
      if (isNodeError(error, "ENOENT")) {
        return { entries: [] as JournalEntry<Payload>[], repairedBytes: 0, count: 0 };
      }
      throw error;
    }
    try {
      const stat = await handle.stat({ bigint: true });
      const cached = snapshots.get(this) as JournalSnapshot<Payload> | undefined;
      if (cached?.fingerprint === fingerprint(stat)) {
        this.rememberSnapshot(cached);
        if (after >= cached.count || limit === 0) {
          return { entries: [] as JournalEntry<Payload>[], repairedBytes: 0, count: cached.count };
        }
        if (cached.entries) {
          return { entries: structuredClone(cached.entries.slice(after, after + limit)),
            repairedBytes: 0, count: cached.count };
        }
        if (cached.offsets.length === cached.count + 1) {
          const end = Math.min(cached.count, after + limit);
          const data = Buffer.alloc(cached.offsets[end] - cached.offsets[after]);
          let read = 0;
          while (read < data.length) {
            const result = await handle.read(data, read, data.length - read, cached.offsets[after] + read);
            if (result.bytesRead === 0) throw new StorageCorruptionError(this.filePath, "journal changed during read");
            read += result.bytesRead;
          }
          const entries: JournalEntry<Payload>[] = [];
          let start = 0;
          for (let sequence = after + 1; sequence <= end; sequence += 1) {
            const finish = cached.offsets[sequence] - cached.offsets[after] - 1;
            entries.push(this.parseEntry(data.subarray(start, finish).toString("utf8"), sequence));
            start = finish + 1;
          }
          return { entries, repairedBytes: 0, count: cached.count };
        }
      }
      // Any external change, even a same-size in-place rewrite, revalidates the
      // complete file. Only our own fsynced appends can extend a trusted index.
      this.forgetSnapshot();
      const data = await handle.readFile();
      const entries: JournalEntry<Payload>[] = [];
      const retained: JournalEntry<Payload>[] | undefined = data.length <= MAX_SNAPSHOT_BYTES ? [] : undefined;
      const offsets = [0];
      let lineStart = 0;
      let count = 0;
      let contiguousSequenceOffset: number | undefined;
      for (let index = data.indexOf(0x0a); index !== -1; index = data.indexOf(0x0a, lineStart)) {
        const entry = this.parseEntry(data.subarray(lineStart, index).toString("utf8"), count + 1);
        contiguousSequenceOffset = this.validateContiguousSequence(entry, contiguousSequenceOffset);
        count += 1;
        retained?.push(entry);
        if (count > after && entries.length < limit) entries.push(entry);
        lineStart = index + 1;
        if (offsets.length <= MAX_INDEX_ENTRIES) offsets.push(lineStart);
      }
      const repairedBytes = data.length - lineStart;
      let finalStat = stat;
      if (repairedBytes > 0) {
        if (!repairIncompleteTail) {
          throw new StorageCorruptionError(this.filePath, "journal ends with an incomplete record");
        }
        const writer = await open(this.filePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
        try {
          if (fingerprint(await writer.stat({ bigint: true })) !== fingerprint(stat)) {
            throw new StorageCorruptionError(this.filePath, "journal changed during repair");
          }
          await writer.truncate(lineStart);
          await writer.sync();
          finalStat = await writer.stat({ bigint: true });
        } finally {
          await writer.close();
        }
        await fsyncDirectory(path.dirname(this.filePath));
      }
      this.rememberSnapshot({ fingerprint: fingerprint(finalStat), offsets, count, bytes: lineStart,
        contiguousSequenceOffset,
        // Readers and predicate callbacks must not be able to mutate cached data.
        entries: retained ? structuredClone(retained) : undefined,
        weight: offsets.length * 16 + (retained ? lineStart * 4 : 0) + 256 });
      return { entries, repairedBytes, count };
    } finally {
      await handle.close();
    }
  }

  private async writeEntries(entries: JournalEntry<Payload>[]) {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const cached = snapshots.get(this) as JournalSnapshot<Payload> | undefined;
    const handle = await open(this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const before = await handle.stat({ bigint: true });
      let contiguousSequenceOffset = cached?.fingerprint === fingerprint(before)
        ? cached.contiguousSequenceOffset : undefined;
      for (const entry of entries) {
        contiguousSequenceOffset = this.validateContiguousSequence(entry, contiguousSequenceOffset);
      }
      const lines = entries.map((entry) => `${JSON.stringify(entry)}\n`);
      this.forgetSnapshot();
      await handle.writeFile(lines.join(""), "utf8");
      await handle.sync();
      const after = await handle.stat({ bigint: true });
      if (cached?.fingerprint === fingerprint(before) || before.size === 0n) {
        const offsets = cached ? [...cached.offsets] : [0];
        let bytes = Number(before.size);
        for (const line of lines) {
          bytes += Buffer.byteLength(line);
          if (offsets.length <= MAX_INDEX_ENTRIES) offsets.push(bytes);
        }
        const retained = bytes <= MAX_SNAPSHOT_BYTES && (cached?.entries || before.size === 0n)
          ? structuredClone([...(cached?.entries ?? []), ...entries]) : undefined;
        this.rememberSnapshot({ fingerprint: fingerprint(after), offsets,
          count: (cached?.count ?? 0) + entries.length, bytes, entries: retained, contiguousSequenceOffset,
          weight: offsets.length * 16 + (retained ? bytes * 4 : 0) + 256 });
      }
      if (before.size === 0n) await fsyncDirectory(directory);
    } finally {
      await handle.close();
    }
  }

  async appendIf(
    payload: Payload,
    shouldAppend: (entries: readonly JournalEntry<Payload>[]) => boolean | Promise<boolean>,
  ) {
    const validatedPayload = this.payloadSchema.parse(payload, `${this.filePath}:payload`);
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const { entries } = await this.readUnlocked(true);
      if (!await shouldAppend(entries)) return null;
      const entry = this.entrySchema.parse({
        schemaVersion: 1,
        sequence: (entries.at(-1)?.sequence ?? 0) + 1,
        eventId: randomUUID(),
        recordedAt: new Date(this.now()).toISOString(),
        payload: validatedPayload,
      });

      await this.writeEntries([entry]);
      return entry;
    });
  }

  async append(payload: Payload) {
    const validatedPayload = this.payloadSchema.parse(payload, `${this.filePath}:payload`);
    return new Promise<JournalEntry<Payload>>((resolve, reject) => {
      this.appendQueue.push({ payload: validatedPayload, resolve, reject });
      this.scheduleAppendDrain();
    });
  }

  private scheduleAppendDrain() {
    if (this.appendScheduled || this.appendDraining) return;
    this.appendScheduled = true;
    queueMicrotask(() => {
      this.appendScheduled = false;
      void this.drainAppends();
    });
  }

  private async drainAppends() {
    if (this.appendDraining) return;
    this.appendDraining = true;
    const jobs = this.appendQueue.splice(0);
    try {
      const appended = await this.lockManager.withLock(this.lockKey(), async () => {
        await this.assertNotSymlink();
        const { count } = await this.readUnlocked(true, { limit: 0 });
        const created = jobs.map((job, index) => this.entrySchema.parse({
          schemaVersion: 1,
          sequence: count + index + 1,
          eventId: randomUUID(),
          recordedAt: new Date(this.now()).toISOString(),
          payload: job.payload,
        }));
        await this.writeEntries(created);
        return created;
      });
      jobs.forEach((job, index) => job.resolve(appended[index]));
    } catch (error) {
      jobs.forEach((job) => job.reject(error));
    } finally {
      this.appendDraining = false;
      if (this.appendQueue.length > 0) this.scheduleAppendDrain();
    }
  }

  async read(options: JournalReadOptions = {}) {
    const afterSequence = options.afterSequence ?? 0;
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new StorageError(
        "STORAGE_JOURNAL_READ_INVALID",
        "afterSequence must be a non-negative safe integer.",
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new StorageError(
        "STORAGE_JOURNAL_READ_INVALID",
        "limit must be a positive safe integer.",
      );
    }

    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const { entries } = await this.readUnlocked(true, { afterSequence, limit });
      return entries;
    });
  }

  async readLast() {
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const { count } = await this.readUnlocked(true, { limit: 0 });
      if (count === 0) return null;
      return (await this.readUnlocked(true, { afterSequence: count - 1, limit: 1 })).entries[0];
    });
  }

  /** Read a contiguous payload sequence that survives internal renumbering on compaction. */
  async readContiguous(
    afterSequence: number,
    limit: number,
  ) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 ||
        !Number.isSafeInteger(limit) || limit < 1) {
      throw new StorageError("STORAGE_JOURNAL_READ_INVALID", "Invalid contiguous journal read bounds.");
    }
    const sequenceOf = this.contiguousPayloadSequence;
    if (!sequenceOf) {
      throw new StorageError("STORAGE_JOURNAL_READ_INVALID", "Contiguous payload sequences must be configured on the journal.");
    }
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const first = (await this.readUnlocked(true, { limit: 1 })).entries[0];
      if (!first) return [];
      const firstSequence = sequenceOf(first.payload);
      const internalAfter = Math.max(0, afterSequence - firstSequence + 1);
      const { entries } = await this.readUnlocked(true, { afterSequence: internalAfter, limit });
      for (const entry of entries) {
        if (sequenceOf(entry.payload) !== firstSequence + entry.sequence - 1) {
          throw new StorageCorruptionError(this.filePath, "non-contiguous payload sequence");
        }
      }
      return entries;
    });
  }

  /**
   * Atomically rewrites a journal under its normal cross-process lock.
   *
   * This is intended only for operational ledgers whose authoritative cursor
   * or projection is stored separately. The callback receives validated
   * entries and returns the payloads that must remain, in their new order.
   */
  async compact(
    retain: (entries: readonly JournalEntry<Payload>[]) => readonly Payload[] | undefined,
  ) {
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const { entries } = await this.readUnlocked(true);
      const retained = retain(entries);
      if (retained === undefined) {
        return Object.freeze({ before: entries.length, after: entries.length, changed: false });
      }
      const payloads = retained.map((payload) =>
        this.payloadSchema.parse(payload, `${this.filePath}:compaction`));
      const compacted = payloads.map((payload, index) => this.entrySchema.parse({
        schemaVersion: 1,
        sequence: index + 1,
        eventId: randomUUID(),
        recordedAt: new Date(this.now()).toISOString(),
        payload,
      }));
      let contiguousSequenceOffset: number | undefined;
      for (const entry of compacted) {
        contiguousSequenceOffset = this.validateContiguousSequence(entry, contiguousSequenceOffset);
      }
      this.forgetSnapshot();
      await atomicWriteFile(
        this.filePath,
        compacted.length === 0
          ? ""
          : `${compacted.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        { mode: 0o600 },
      );
      return Object.freeze({ before: entries.length, after: compacted.length, changed: true });
    });
  }

  async verifyAndRepair() {
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      // Explicit verification always checks bytes, including previously indexed history.
      this.forgetSnapshot();
      const result = await this.readUnlocked(true, { limit: 0 });
      return {
        count: result.count,
        lastSequence: result.count,
        repairedBytes: result.repairedBytes,
      };
    });
  }
}
