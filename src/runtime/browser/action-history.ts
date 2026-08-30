import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  FileJournal,
  ResourceLockManager,
  ValidationContext,
  expectLiteral,
  expectOneOf,
  expectString,
  expectStrictRecord,
  type StorageSchema,
} from "@/storage";

const ACTIONS = ["open", "read", "screenshot", "scroll", "click", "type", "tabs", "downloads"] as const;
const PHASES = ["started", "dispatched", "completed", "denied", "indeterminate"] as const;
const ACTORS = ["agent", "human"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const MAX_HISTORY_EVENTS = 50_000;

export type BrowserActionHistoryEvent = Readonly<{
  schemaVersion: 1;
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  callId: string;
  action: typeof ACTIONS[number];
  phase: typeof PHASES[number];
  success: boolean | null;
  actor: typeof ACTORS[number];
}>;

export type BrowserActionHistoryItem = BrowserActionHistoryEvent & Readonly<{
  sequence: number;
  occurredAt: string;
}>;

const eventSchema: StorageSchema<BrowserActionHistoryEvent> = {
  name: "BrowserActionHistoryEvent",
  parse(value, source = "BrowserActionHistoryEvent") {
    const context = new ValidationContext("BrowserActionHistoryEvent", source);
    const record = expectStrictRecord(value, [
      "schemaVersion", "installationId", "userId", "threadId", "turnId", "callId",
      "action", "phase", "success", "actor",
    ], context);
    const phase = expectOneOf(record.phase, PHASES, context.at("phase"));
    const success = record.success === null ? null
      : typeof record.success === "boolean" ? record.success : context.at("success").fail("expected boolean or null");
    if ((phase === "dispatched" || phase === "completed" || phase === "denied" || phase === "indeterminate") !== (success !== null)) {
      context.at("success").fail("must exist only for terminal history events");
    }
    return {
      schemaVersion: expectLiteral(record.schemaVersion, 1, context.at("schemaVersion")),
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2, maxLength: 63, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/u,
      }),
      userId: expectString(record.userId, context.at("userId"), {
        minLength: 36, maxLength: 36, pattern: UUID_PATTERN,
      }),
      threadId: expectString(record.threadId, context.at("threadId"), {
        minLength: 36, maxLength: 36, pattern: UUID_PATTERN,
      }),
      turnId: expectString(record.turnId, context.at("turnId"), {
        minLength: 1, maxLength: 256, pattern: OPAQUE_ID_PATTERN,
      }),
      callId: expectString(record.callId, context.at("callId"), {
        minLength: 1, maxLength: 256, pattern: OPAQUE_ID_PATTERN,
      }),
      action: expectOneOf(record.action, ACTIONS, context.at("action")),
      phase,
      success,
      actor: expectOneOf(record.actor, ACTORS, context.at("actor")),
    };
  },
};

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (code === undefined || (error as NodeJS.ErrnoException).code === code));
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Browser action history directory is unsafe.");
  }
}

export class BrowserActionHistoryStore {
  readonly root: string;
  readonly historyPath: string;
  private readonly userId: string;
  private readonly journal: FileJournal<BrowserActionHistoryEvent>;

  constructor(options: { userRoot: string; now?: () => number }) {
    if (!path.isAbsolute(options.userRoot)) throw new Error("Browser action history user root must be absolute.");
    const resolvedUserRoot = path.resolve(options.userRoot);
    this.userId = path.basename(resolvedUserRoot);
    if (!UUID_PATTERN.test(this.userId)) throw new Error("Browser action history user root is invalid.");
    this.root = path.join(resolvedUserRoot, "browser");
    this.historyPath = path.join(this.root, "action-history.jsonl");
    const locks = new ResourceLockManager({ rootDirectory: path.join(this.root, "history-locks") });
    this.journal = new FileJournal({
      filePath: this.historyPath,
      lockManager: locks,
      payloadSchema: eventSchema,
      now: options.now,
    });
  }

  private async prepare() {
    const userRoot = path.dirname(this.root);
    const metadata = await lstat(userRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new Error("Browser action history user root is unsafe.");
    }
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(path.join(this.root, "history-locks"));
    const [canonicalUser, canonicalRoot] = await Promise.all([realpath(userRoot), realpath(this.root)]);
    const relative = path.relative(canonicalUser, canonicalRoot);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Browser action history escapes the user root.");
    }
  }

  async append(event: BrowserActionHistoryEvent) {
    if (event.userId !== this.userId) throw new Error("Browser action history user binding is invalid.");
    await this.prepare();
    return this.journal.appendIf(event, (entries) => {
      if (entries.length >= MAX_HISTORY_EVENTS) throw new Error("Browser action history requires archival.");
      return !entries.some(({ payload }) => payload.threadId === event.threadId &&
        payload.turnId === event.turnId && payload.callId === event.callId && payload.phase === event.phase);
    });
  }

  async list(threadId: string, limit = 50): Promise<BrowserActionHistoryItem[]> {
    if (!UUID_PATTERN.test(threadId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Browser action history query is invalid.");
    }
    await this.prepare();
    const entries = await this.journal.read();
    return entries
      .filter(({ payload }) => payload.threadId === threadId)
      .slice(-limit)
      .reverse()
      .map(({ sequence, recordedAt, payload }) => ({ ...payload, sequence, occurredAt: recordedAt }));
  }
}
