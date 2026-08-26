import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fsyncDirectory } from "@/storage/atomic-file";
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
};

export type JournalReadOptions = {
  afterSequence?: number;
  limit?: number;
};

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

  private async readUnlocked(repairIncompleteTail: boolean) {
    let data: Buffer;
    try {
      data = await readFile(this.filePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return { entries: [] as JournalEntry<Payload>[], repairedBytes: 0 };
      }
      throw error;
    }

    const entries: JournalEntry<Payload>[] = [];
    let lineStart = 0;
    let expectedSequence = 1;
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0x0a) continue;
      const line = data.subarray(lineStart, index).toString("utf8");
      if (line.length === 0) {
        throw new StorageCorruptionError(this.filePath, `empty journal record at sequence ${expectedSequence}`);
      }
      let entry: JournalEntry<Payload>;
      try {
        entry = parseJson(this.entrySchema, line, `${this.filePath}:${expectedSequence}`);
      } catch (error) {
        throw new StorageCorruptionError(
          this.filePath,
          `invalid complete journal record at sequence ${expectedSequence}`,
          { cause: error },
        );
      }
      if (entry.sequence !== expectedSequence) {
        throw new StorageCorruptionError(
          this.filePath,
          `expected sequence ${expectedSequence}, found ${entry.sequence}`,
        );
      }
      entries.push(entry);
      expectedSequence += 1;
      lineStart = index + 1;
    }

    const repairedBytes = data.length - lineStart;
    if (repairedBytes > 0) {
      if (!repairIncompleteTail) {
        throw new StorageCorruptionError(this.filePath, "journal ends with an incomplete record");
      }
      const handle = await open(this.filePath, "r+");
      try {
        await handle.truncate(lineStart);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsyncDirectory(path.dirname(this.filePath));
    }

    return { entries, repairedBytes };
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

      const directory = path.dirname(this.filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let existed = true;
      try {
        await lstat(this.filePath);
      } catch (error) {
        if (isNodeError(error, "ENOENT")) existed = false;
        else throw error;
      }
      const flags = constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0);
      const handle = await open(this.filePath, flags, 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (!existed) await fsyncDirectory(directory);
      return entry;
    });
  }

  async append(payload: Payload) {
    const appended = await this.appendIf(payload, () => true);
    if (!appended) {
      throw new StorageError("STORAGE_JOURNAL_APPEND_REJECTED", "Journal append was rejected unexpectedly.");
    }
    return appended;
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
      const { entries } = await this.readUnlocked(true);
      return entries
        .filter((entry) => entry.sequence > afterSequence)
        .slice(0, limit);
    });
  }

  async verifyAndRepair() {
    return this.lockManager.withLock(this.lockKey(), async () => {
      await this.assertNotSymlink();
      const result = await this.readUnlocked(true);
      return {
        count: result.entries.length,
        lastSequence: result.entries.at(-1)?.sequence ?? 0,
        repairedBytes: result.repairedBytes,
      };
    });
  }
}
