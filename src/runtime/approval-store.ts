import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ApprovalDecision, ApprovalItem } from "@/lib/chat-contract";
import {
  FileJournal,
  ResourceLockManager,
  ValidationContext,
  atomicWriteJson,
  defineVersionedSchema,
  expectIsoDate,
  expectLiteral,
  expectOneOf,
  expectStrictRecord,
  expectString,
  readValidatedJson,
  type StorageSchema,
} from "@/storage";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTALLATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DEFAULT_APPROVAL_TTL_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 75;

export type ApprovalRequestType = "command" | "file" | "permissions";
export type ApprovalStatus = "pending" | "resolved" | "cancelled" | "expired";

export type ApprovalLocator = {
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId: string;
};

export type ApprovalRecord = ApprovalLocator & {
  schemaVersion: 1;
  requestType: ApprovalRequestType;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  requestedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
};

export type ApprovalJournalEvent = ApprovalLocator & {
  schemaVersion: 1;
  eventType: "requested" | "resolved" | "cancelled" | "expired";
  requestType: ApprovalRequestType;
  decision: ApprovalDecision | null;
  occurredAt: string;
};

export class ApprovalStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "ApprovalStoreError";
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function expectOpaqueId(value: unknown, context: ValidationContext) {
  return expectString(value, context, {
    minLength: 1,
    maxLength: 256,
    pattern: OPAQUE_ID_PATTERN,
  });
}

function parseLocator(record: Readonly<Record<string, unknown>>, context: ValidationContext) {
  return {
    installationId: expectString(record.installationId, context.at("installationId"), {
      minLength: 2,
      maxLength: 63,
      pattern: INSTALLATION_ID_PATTERN,
    }),
    userId: expectString(record.userId, context.at("userId"), {
      minLength: 36,
      maxLength: 36,
      pattern: USER_ID_PATTERN,
    }),
    threadId: expectOpaqueId(record.threadId, context.at("threadId")),
    turnId: expectOpaqueId(record.turnId, context.at("turnId")),
    itemId: expectOpaqueId(record.itemId, context.at("itemId")),
    approvalId: expectOpaqueId(record.approvalId, context.at("approvalId")),
  };
}

function parseNullableDecision(value: unknown, context: ValidationContext) {
  return value === null
    ? null
    : expectOneOf(value, ["accept", "acceptForSession", "decline"] as const, context);
}

export const approvalRecordSchema = defineVersionedSchema<ApprovalRecord>({
  name: "ApprovalRecord",
  schemaVersion: 1,
  keys: [
    "installationId",
    "userId",
    "threadId",
    "turnId",
    "itemId",
    "approvalId",
    "requestType",
    "status",
    "decision",
    "requestedAt",
    "expiresAt",
    "resolvedAt",
  ],
  parse(record, context) {
    const parsed: ApprovalRecord = {
      schemaVersion: 1,
      ...parseLocator(record, context),
      requestType: expectOneOf(
        record.requestType,
        ["command", "file", "permissions"] as const,
        context.at("requestType"),
      ),
      status: expectOneOf(
        record.status,
        ["pending", "resolved", "cancelled", "expired"] as const,
        context.at("status"),
      ),
      decision: parseNullableDecision(record.decision, context.at("decision")),
      requestedAt: expectIsoDate(record.requestedAt, context.at("requestedAt")),
      expiresAt: expectIsoDate(record.expiresAt, context.at("expiresAt")),
      resolvedAt: record.resolvedAt === null
        ? null
        : expectIsoDate(record.resolvedAt, context.at("resolvedAt")),
    };
    if (new Date(parsed.expiresAt).valueOf() <= new Date(parsed.requestedAt).valueOf()) {
      context.at("expiresAt").fail("must be later than requestedAt");
    }
    if (parsed.status === "pending" && (parsed.decision !== null || parsed.resolvedAt !== null)) {
      context.fail("pending approvals cannot have a decision or resolvedAt");
    }
    if (parsed.status === "resolved" && (parsed.decision === null || parsed.resolvedAt === null)) {
      context.fail("resolved approvals require a decision and resolvedAt");
    }
    if ((parsed.status === "cancelled" || parsed.status === "expired") &&
        (parsed.decision !== null || parsed.resolvedAt === null)) {
      context.fail("cancelled and expired approvals require resolvedAt without a decision");
    }
    return parsed;
  },
});

export const approvalJournalEventSchema: StorageSchema<ApprovalJournalEvent> = {
  name: "ApprovalJournalEvent",
  parse(value: unknown, source = "ApprovalJournalEvent") {
    const context = new ValidationContext("ApprovalJournalEvent", source);
    const record = expectStrictRecord(value, [
      "schemaVersion",
      "installationId",
      "userId",
      "threadId",
      "turnId",
      "itemId",
      "approvalId",
      "eventType",
      "requestType",
      "decision",
      "occurredAt",
    ], context);
    const event: ApprovalJournalEvent = {
      schemaVersion: expectLiteral(record.schemaVersion, 1, context.at("schemaVersion")),
      ...parseLocator(record, context),
      eventType: expectOneOf(
        record.eventType,
        ["requested", "resolved", "cancelled", "expired"] as const,
        context.at("eventType"),
      ),
      requestType: expectOneOf(
        record.requestType,
        ["command", "file", "permissions"] as const,
        context.at("requestType"),
      ),
      decision: parseNullableDecision(record.decision, context.at("decision")),
      occurredAt: expectIsoDate(record.occurredAt, context.at("occurredAt")),
    };
    if ((event.eventType === "resolved") !== (event.decision !== null)) {
      context.at("decision").fail("must exist only for resolved events");
    }
    return event;
  },
};

function locatorKey(locator: ApprovalLocator) {
  return createHash("sha256").update(JSON.stringify([
    locator.installationId,
    locator.userId,
    locator.threadId,
    locator.turnId,
    locator.itemId,
    locator.approvalId,
  ])).digest("hex");
}

function recordsMatch(left: ApprovalLocator, right: ApprovalLocator) {
  return left.installationId === right.installationId &&
    left.userId === right.userId &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.itemId === right.itemId &&
    left.approvalId === right.approvalId;
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function assertDirectory(directory: string, ownerOnly: boolean) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval paths must be real directories.");
  }
  if ((metadata.mode & (ownerOnly ? 0o077 : 0o022)) !== 0) {
    throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval directory permissions are unsafe.");
  }
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  await assertDirectory(directory, true);
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export type FileApprovalStoreOptions = {
  installationId: string;
  userId: string;
  usersRoot: string;
  defaultTtlMs?: number;
  now?: () => number;
};

export class FileApprovalStore {
  readonly installationId: string;
  readonly userId: string;
  readonly userRoot: string;
  readonly approvalsRoot: string;
  readonly recordsRoot: string;
  readonly journalPath: string;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly locks: ResourceLockManager;
  private readonly journal: FileJournal<ApprovalJournalEvent>;

  constructor(options: FileApprovalStoreOptions) {
    if (!INSTALLATION_ID_PATTERN.test(options.installationId)) {
      throw new ApprovalStoreError("APPROVAL_IDENTITY_INVALID", "Approval installationId is invalid.");
    }
    if (!USER_ID_PATTERN.test(options.userId)) {
      throw new ApprovalStoreError("APPROVAL_IDENTITY_INVALID", "Approval userId is invalid.");
    }
    if (!path.isAbsolute(options.usersRoot)) {
      throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval usersRoot must be absolute.");
    }
    const ttl = options.defaultTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl < 1) {
      throw new ApprovalStoreError("APPROVAL_OPTIONS_INVALID", "Approval TTL must be positive.");
    }
    this.installationId = options.installationId;
    this.userId = options.userId;
    const usersRoot = path.resolve(options.usersRoot);
    this.userRoot = path.resolve(usersRoot, options.userId);
    if (this.userRoot === usersRoot || !isInside(usersRoot, this.userRoot)) {
      throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval user root escapes usersRoot.");
    }
    this.approvalsRoot = path.join(this.userRoot, "approvals");
    this.recordsRoot = path.join(this.approvalsRoot, "records");
    this.journalPath = path.join(this.approvalsRoot, "events.jsonl");
    this.defaultTtlMs = ttl;
    this.now = options.now ?? Date.now;
    this.locks = new ResourceLockManager({
      rootDirectory: path.join(this.approvalsRoot, "locks"),
    });
    this.journal = new FileJournal({
      filePath: this.journalPath,
      lockManager: this.locks,
      payloadSchema: approvalJournalEventSchema,
      now: this.now,
    });
  }

  private assertLocator(locator: ApprovalLocator) {
    const parsed = approvalJournalEventSchema.parse({
      schemaVersion: 1,
      ...locator,
      eventType: "requested",
      requestType: "command",
      decision: null,
      occurredAt: new Date(this.now()).toISOString(),
    });
    if (parsed.installationId !== this.installationId || parsed.userId !== this.userId) {
      throw new ApprovalStoreError(
        "APPROVAL_IDENTITY_MISMATCH",
        "Approval locator does not belong to this installation and user.",
      );
    }
    return locator;
  }

  private recordPath(locator: ApprovalLocator) {
    return path.join(this.recordsRoot, `${locatorKey(locator)}.json`);
  }

  private lockKey(locator: ApprovalLocator) {
    return `approval:${locatorKey(locator)}`;
  }

  private async prepare() {
    const usersRoot = path.dirname(this.userRoot);
    await assertDirectory(usersRoot, false);
    await assertDirectory(this.userRoot, true);
    const [canonicalUsersRoot, canonicalUserRoot] = await Promise.all([
      realpath(usersRoot),
      realpath(this.userRoot),
    ]);
    if (canonicalUserRoot === canonicalUsersRoot || !isInside(canonicalUsersRoot, canonicalUserRoot)) {
      throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval user root is outside usersRoot.");
    }
    await ensurePrivateDirectory(this.approvalsRoot);
    await ensurePrivateDirectory(this.recordsRoot);
    await ensurePrivateDirectory(path.join(this.approvalsRoot, "locks"));
  }

  private async readUnlocked(locator: ApprovalLocator) {
    const recordPath = this.recordPath(locator);
    try {
      const metadata = await lstat(recordPath);
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1 ||
          (metadata.mode & 0o077) !== 0) {
        throw new ApprovalStoreError("APPROVAL_PATH_UNSAFE", "Approval record path is unsafe.");
      }
      const record = await readValidatedJson(recordPath, approvalRecordSchema);
      if (!recordsMatch(record, locator)) {
        throw new ApprovalStoreError("APPROVAL_RECORD_MISMATCH", "Approval record key mismatch.");
      }
      return record;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async writeUnlocked(record: ApprovalRecord) {
    await atomicWriteJson(this.recordPath(record), record, approvalRecordSchema, { mode: 0o600 });
  }

  private async appendEvent(record: ApprovalRecord, eventType: ApprovalJournalEvent["eventType"]) {
    const event: ApprovalJournalEvent = {
      schemaVersion: 1,
      installationId: record.installationId,
      userId: record.userId,
      threadId: record.threadId,
      turnId: record.turnId,
      itemId: record.itemId,
      approvalId: record.approvalId,
      eventType,
      requestType: record.requestType,
      decision: eventType === "resolved" ? record.decision : null,
      occurredAt: eventType === "requested"
        ? record.requestedAt
        : record.resolvedAt ?? record.requestedAt,
    };
    await this.journal.appendIf(event, (entries) => !entries.some(({ payload }) =>
      recordsMatch(payload, event) &&
      payload.eventType === event.eventType &&
      payload.decision === event.decision));
  }

  private async repairJournal(record: ApprovalRecord) {
    await this.appendEvent(record, "requested");
    if (record.status !== "pending") await this.appendEvent(record, record.status);
  }

  private async expireUnlocked(record: ApprovalRecord) {
    if (record.status !== "pending" || new Date(record.expiresAt).valueOf() > this.now()) {
      return record;
    }
    const expired = approvalRecordSchema.parse({
      ...record,
      status: "expired",
      decision: null,
      resolvedAt: new Date(this.now()).toISOString(),
    });
    await this.writeUnlocked(expired);
    await this.appendEvent(expired, "expired");
    return expired;
  }

  async createPending(input: {
    locator: ApprovalLocator;
    requestType: ApprovalRequestType;
    ttlMs?: number;
  }) {
    const locator = this.assertLocator(input.locator);
    const ttlMs = input.ttlMs ?? this.defaultTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new ApprovalStoreError("APPROVAL_OPTIONS_INVALID", "Approval TTL must be positive.");
    }
    await this.prepare();
    return this.locks.withLock(this.lockKey(locator), async () => {
      const existing = await this.readUnlocked(locator);
      if (existing) {
        if (existing.requestType !== input.requestType) {
          throw new ApprovalStoreError("APPROVAL_RECORD_MISMATCH", "Approval request type changed.");
        }
        const recovered = await this.expireUnlocked(existing);
        await this.repairJournal(recovered);
        return recovered;
      }
      const requestedAtMs = this.now();
      const record = approvalRecordSchema.parse({
        schemaVersion: 1,
        ...locator,
        requestType: input.requestType,
        status: "pending",
        decision: null,
        requestedAt: new Date(requestedAtMs).toISOString(),
        expiresAt: new Date(requestedAtMs + ttlMs).toISOString(),
        resolvedAt: null,
      });
      await this.writeUnlocked(record);
      await this.appendEvent(record, "requested");
      return record;
    });
  }

  async read(locatorInput: ApprovalLocator) {
    const locator = this.assertLocator(locatorInput);
    await this.prepare();
    return this.locks.withLock(this.lockKey(locator), async () => {
      const record = await this.readUnlocked(locator);
      return record ? this.expireUnlocked(record) : null;
    });
  }

  async resolve(locatorInput: ApprovalLocator, decision: ApprovalDecision) {
    const locator = this.assertLocator(locatorInput);
    if (!(["accept", "acceptForSession", "decline"] as const).includes(decision)) {
      throw new ApprovalStoreError("APPROVAL_DECISION_INVALID", "Approval decision is invalid.");
    }
    await this.prepare();
    return this.locks.withLock(this.lockKey(locator), async () => {
      const found = await this.readUnlocked(locator);
      if (!found) return { outcome: "not-found" as const, record: null };
      const record = await this.expireUnlocked(found);
      if (record.status === "resolved") {
        if (record.decision !== decision) {
          throw new ApprovalStoreError(
            "APPROVAL_DECISION_CONFLICT",
            "Approval was already resolved with a different decision.",
          );
        }
        await this.repairJournal(record);
        return { outcome: "already-resolved" as const, record };
      }
      if (record.status !== "pending") {
        return { outcome: "not-pending" as const, record };
      }
      const resolved = approvalRecordSchema.parse({
        ...record,
        status: "resolved",
        decision,
        resolvedAt: new Date(this.now()).toISOString(),
      });
      await this.writeUnlocked(resolved);
      await this.appendEvent(resolved, "resolved");
      return { outcome: "resolved" as const, record: resolved };
    });
  }

  async cancel(locatorInput: ApprovalLocator) {
    const locator = this.assertLocator(locatorInput);
    await this.prepare();
    return this.locks.withLock(this.lockKey(locator), async () => {
      const record = await this.readUnlocked(locator);
      if (!record || record.status !== "pending") return record;
      const cancelled = approvalRecordSchema.parse({
        ...record,
        status: "cancelled",
        decision: null,
        resolvedAt: new Date(this.now()).toISOString(),
      });
      await this.writeUnlocked(cancelled);
      await this.appendEvent(cancelled, "cancelled");
      return cancelled;
    });
  }

  async readEvents() {
    await this.prepare();
    return this.journal.read();
  }
}

export function approvalLocatorFromItem(
  installationId: string,
  userId: string,
  approval: ApprovalItem,
): ApprovalLocator {
  return {
    installationId,
    userId,
    threadId: approval.threadId,
    turnId: approval.turnId,
    itemId: approval.itemId,
    approvalId: approval.id,
  };
}

export async function waitForApproval(
  store: FileApprovalStore,
  approval: ApprovalItem,
  requestType: ApprovalRequestType,
  signal: AbortSignal,
  options: { pollIntervalMs?: number; ttlMs?: number } = {},
): Promise<ApprovalDecision | "cancel"> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new ApprovalStoreError("APPROVAL_OPTIONS_INVALID", "Approval poll interval must be positive.");
  }
  const locator = approvalLocatorFromItem(store.installationId, store.userId, approval);
  if (signal.aborted) {
    await store.cancel(locator);
    return "cancel";
  }
  let record = await store.createPending({
    locator,
    requestType,
    ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
  });
  while (true) {
    if (record.status === "resolved") return record.decision ?? "cancel";
    if (record.status === "cancelled" || record.status === "expired" || signal.aborted) {
      if (record.status === "pending") await store.cancel(locator);
      return "cancel";
    }
    await abortableDelay(pollIntervalMs, signal);
    record = await store.read(locator) ?? record;
  }
}
