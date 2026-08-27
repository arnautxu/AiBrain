import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import {
  ResourceLockManager,
  FileJournal,
  ValidationContext,
  atomicWriteJson,
  defineVersionedSchema,
  expectIsoDate,
  expectLiteral,
  expectOneOf,
  expectString,
  expectStrictRecord,
  readValidatedJson,
  type StorageSchema,
} from "@/storage";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TOOL_PATTERN = /^(open|read|screenshot|scroll|click|type|tabs|downloads)$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_AUDIT_EVENTS = 100_000;

export type BrowserToolCallIdentity = {
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  argumentsHash: string;
  permissionFingerprint: string;
};

export type BrowserToolCallRecord = BrowserToolCallIdentity & {
  schemaVersion: 1;
  status: "pending" | "executing" | "completed";
  response: DynamicToolCallResponse | null;
  approvalRequestedAt: string | null;
  approvalResolvedAt: string | null;
  executingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BrowserToolAuditEvent = {
  schemaVersion: 1;
  callIdentityHash: string;
  tool: string;
  status: "reserved" | "approval_requested" | "approval_resolved" | "executing" | "completed";
  success: boolean | null;
  permissionFingerprint: string;
  occurredAt: string;
};

export class BrowserToolCallStoreError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BrowserToolCallStoreError";
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (code === undefined || (error as NodeJS.ErrnoException).code === code));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: ValidationContext) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    context.fail("keys do not match the browser tool response contract");
  }
}

function parseResponse(value: unknown, context: ValidationContext): DynamicToolCallResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) context.fail("expected an object");
  const record = value as Record<string, unknown>;
  exactKeys(record, ["contentItems", "success"], context);
  if (typeof record.success !== "boolean" || !Array.isArray(record.contentItems) ||
    record.contentItems.length > 4) context.fail("invalid browser tool response");
  const contentItems = record.contentItems.map((item, index) => {
    const itemContext = context.at(`contentItems.${index}`);
    if (!item || typeof item !== "object" || Array.isArray(item)) itemContext.fail("expected an object");
    const entry = item as Record<string, unknown>;
    if (entry.type === "inputText") {
      exactKeys(entry, ["type", "text"], itemContext);
      return {
        type: "inputText" as const,
        text: expectString(entry.text, itemContext.at("text"), { maxLength: 100_000 }),
      };
    }
    if (entry.type === "inputImage") {
      exactKeys(entry, ["type", "imageUrl"], itemContext);
      const imageUrl = expectString(entry.imageUrl, itemContext.at("imageUrl"), {
        minLength: 30,
        maxLength: 28_000_000,
      });
      if (!imageUrl.startsWith("data:image/png;base64,")) itemContext.at("imageUrl").fail("expected a PNG data URL");
      return { type: "inputImage" as const, imageUrl };
    }
    return itemContext.at("type").fail("unsupported browser tool content type");
  });
  return { success: record.success, contentItems };
}

export const browserToolCallRecordSchema = defineVersionedSchema<BrowserToolCallRecord>({
  name: "BrowserToolCallRecord",
  schemaVersion: 1,
  keys: [
    "installationId", "userId", "threadId", "turnId", "callId", "tool",
    "argumentsHash", "permissionFingerprint", "status", "response", "approvalRequestedAt",
    "approvalResolvedAt", "executingAt", "createdAt", "updatedAt",
  ],
  parse(record, context) {
    const parsed: BrowserToolCallRecord = {
      schemaVersion: 1,
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2, maxLength: 63, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/u,
      }),
      userId: expectString(record.userId, context.at("userId"), {
        minLength: 36, maxLength: 36,
        pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      }),
      threadId: expectString(record.threadId, context.at("threadId"), { minLength: 1, maxLength: 256, pattern: OPAQUE_ID_PATTERN }),
      turnId: expectString(record.turnId, context.at("turnId"), { minLength: 1, maxLength: 256, pattern: OPAQUE_ID_PATTERN }),
      callId: expectString(record.callId, context.at("callId"), { minLength: 1, maxLength: 256, pattern: OPAQUE_ID_PATTERN }),
      tool: expectString(record.tool, context.at("tool"), { minLength: 1, maxLength: 32, pattern: TOOL_PATTERN }),
      argumentsHash: expectString(record.argumentsHash, context.at("argumentsHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      permissionFingerprint: expectString(record.permissionFingerprint, context.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      status: expectOneOf(record.status, ["pending", "executing", "completed"] as const, context.at("status")),
      response: record.response === null ? null : parseResponse(record.response, context.at("response")),
      approvalRequestedAt: record.approvalRequestedAt === null
        ? null : expectIsoDate(record.approvalRequestedAt, context.at("approvalRequestedAt")),
      approvalResolvedAt: record.approvalResolvedAt === null
        ? null : expectIsoDate(record.approvalResolvedAt, context.at("approvalResolvedAt")),
      executingAt: record.executingAt === null
        ? null : expectIsoDate(record.executingAt, context.at("executingAt")),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
      updatedAt: expectIsoDate(record.updatedAt, context.at("updatedAt")),
    };
    if ((parsed.status === "completed") !== (parsed.response !== null)) {
      context.at("response").fail("must exist only for completed calls");
    }
    if (parsed.approvalResolvedAt && !parsed.approvalRequestedAt) {
      context.at("approvalResolvedAt").fail("requires approvalRequestedAt");
    }
    if ((parsed.status === "executing" || parsed.executingAt) && !parsed.executingAt) {
      context.at("executingAt").fail("is required for executing calls");
    }
    if (parsed.updatedAt < parsed.createdAt) context.at("updatedAt").fail("must not precede createdAt");
    return parsed;
  },
});

const browserToolAuditEventSchema: StorageSchema<BrowserToolAuditEvent> = {
  name: "BrowserToolAuditEvent",
  parse(value: unknown, source = "BrowserToolAuditEvent") {
    const context = new ValidationContext("BrowserToolAuditEvent", source);
    const record = expectStrictRecord(value, [
      "schemaVersion", "callIdentityHash", "tool", "status", "success",
      "permissionFingerprint", "occurredAt",
    ], context);
    const status = expectOneOf(record.status, [
      "reserved", "approval_requested", "approval_resolved", "executing", "completed",
    ] as const, context.at("status"));
    const success = record.success === null
      ? null
      : typeof record.success === "boolean" ? record.success : context.at("success").fail("expected boolean or null");
    if ((status === "completed") !== (success !== null)) {
      context.at("success").fail("must exist only for completed events");
    }
    return {
      schemaVersion: expectLiteral(record.schemaVersion, 1, context.at("schemaVersion")),
      callIdentityHash: expectString(record.callIdentityHash, context.at("callIdentityHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      tool: expectString(record.tool, context.at("tool"), { minLength: 1, maxLength: 32, pattern: TOOL_PATTERN }),
      status,
      success,
      permissionFingerprint: expectString(record.permissionFingerprint, context.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      occurredAt: expectIsoDate(record.occurredAt, context.at("occurredAt")),
    };
  },
};

function identityKey(identity: BrowserToolCallIdentity) {
  return createHash("sha256").update(JSON.stringify([
    identity.installationId,
    identity.userId,
    identity.threadId,
    identity.turnId,
    identity.callId,
  ])).digest("hex");
}

function sameIdentity(record: BrowserToolCallRecord, identity: BrowserToolCallIdentity) {
  return record.installationId === identity.installationId && record.userId === identity.userId &&
    record.threadId === identity.threadId && record.turnId === identity.turnId &&
    record.callId === identity.callId && record.tool === identity.tool &&
    record.argumentsHash === identity.argumentsHash &&
    record.permissionFingerprint === identity.permissionFingerprint;
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool call path is unsafe.");
  }
}

export class BrowserToolCallStore {
  readonly root: string;
  readonly recordsRoot: string;
  readonly auditPath: string;
  private readonly locks: ResourceLockManager;
  private readonly audit: FileJournal<BrowserToolAuditEvent>;
  private readonly now: () => number;

  constructor(options: { userRoot: string; now?: () => number }) {
    if (!path.isAbsolute(options.userRoot)) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool user root must be absolute.");
    }
    this.root = path.join(path.resolve(options.userRoot), "browser", "tool-calls");
    this.recordsRoot = path.join(this.root, "records");
    this.auditPath = path.join(this.root, "audit.jsonl");
    this.locks = new ResourceLockManager({ rootDirectory: path.join(this.root, "locks") });
    this.audit = new FileJournal({
      filePath: this.auditPath,
      lockManager: this.locks,
      payloadSchema: browserToolAuditEventSchema,
      now: options.now,
    });
    this.now = options.now ?? Date.now;
  }

  private async prepare() {
    const userRoot = path.dirname(path.dirname(this.root));
    const metadata = await lstat(userRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool user root is unsafe.");
    }
    await ensurePrivateDirectory(path.join(userRoot, "browser"));
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(this.recordsRoot);
    await ensurePrivateDirectory(path.join(this.root, "locks"));
    const [canonicalUser, canonicalRoot] = await Promise.all([realpath(userRoot), realpath(this.root)]);
    const relative = path.relative(canonicalUser, canonicalRoot);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool root escapes the user root.");
    }
  }

  private recordPath(identity: BrowserToolCallIdentity) {
    return path.join(this.recordsRoot, `${identityKey(identity)}.json`);
  }

  private async appendAudit(
    identity: BrowserToolCallIdentity,
    status: BrowserToolAuditEvent["status"],
    occurredAt: string,
    success: boolean | null = null,
  ) {
    const event: BrowserToolAuditEvent = {
      schemaVersion: 1,
      callIdentityHash: identityKey(identity),
      tool: identity.tool,
      status,
      success,
      permissionFingerprint: identity.permissionFingerprint,
      occurredAt,
    };
    await this.audit.appendIf(event, (entries) => {
      if (entries.some(({ payload }) =>
        payload.callIdentityHash === event.callIdentityHash && payload.status === status)) return false;
      if (entries.length >= MAX_AUDIT_EVENTS) {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_AUDIT_CAPACITY",
          "Browser tool audit reached its safe local capacity and requires archival.",
        );
      }
      return true;
    });
  }

  private async repairAudit(record: BrowserToolCallRecord) {
    await this.appendAudit(record, "reserved", record.createdAt);
    if (record.approvalRequestedAt) await this.appendAudit(record, "approval_requested", record.approvalRequestedAt);
    if (record.approvalResolvedAt) await this.appendAudit(record, "approval_resolved", record.approvalResolvedAt);
    if (record.executingAt) await this.appendAudit(record, "executing", record.executingAt);
    if (record.status === "completed") {
      await this.appendAudit(record, "completed", record.updatedAt, record.response?.success ?? false);
    }
  }

  private async readUnlocked(identity: BrowserToolCallIdentity) {
    const recordPath = this.recordPath(identity);
    try {
      const metadata = await lstat(recordPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool record is unsafe.");
      }
      const record = await readValidatedJson(recordPath, browserToolCallRecordSchema);
      if (!sameIdentity(record, identity)) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_REPLAY_CONFLICT", "Browser tool call identity changed during replay.");
      }
      return record;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  async begin(identity: BrowserToolCallIdentity) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const existing = await this.readUnlocked(identity);
      if (existing) {
        await this.repairAudit(existing);
        return existing;
      }
      const now = new Date(this.now()).toISOString();
      const record = browserToolCallRecordSchema.parse({
        schemaVersion: 1,
        ...identity,
        status: "pending",
        response: null,
        approvalRequestedAt: null,
        approvalResolvedAt: null,
        executingAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await atomicWriteJson(this.recordPath(identity), record, browserToolCallRecordSchema, { mode: 0o600 });
      await this.repairAudit(record);
      return record;
    });
  }

  async markApprovalRequested(identity: BrowserToolCallIdentity) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.approvalRequestedAt) {
        await this.repairAudit(current);
        return { record: current, first: false } as const;
      }
      const requested = browserToolCallRecordSchema.parse({
        ...current,
        approvalRequestedAt: new Date(this.now()).toISOString(),
        updatedAt: new Date(this.now()).toISOString(),
      });
      await atomicWriteJson(this.recordPath(identity), requested, browserToolCallRecordSchema, { mode: 0o600 });
      await this.repairAudit(requested);
      return { record: requested, first: true } as const;
    });
  }

  async markApprovalResolved(identity: BrowserToolCallIdentity) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.approvalResolvedAt) {
        await this.repairAudit(current);
        return { record: current, first: false } as const;
      }
      if (!current.approvalRequestedAt) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_STATE_INVALID", "Browser approval was not requested.");
      }
      const resolved = browserToolCallRecordSchema.parse({
        ...current,
        approvalResolvedAt: new Date(this.now()).toISOString(),
        updatedAt: new Date(this.now()).toISOString(),
      });
      await atomicWriteJson(this.recordPath(identity), resolved, browserToolCallRecordSchema, { mode: 0o600 });
      await this.repairAudit(resolved);
      return { record: resolved, first: true } as const;
    });
  }

  async markExecuting(identity: BrowserToolCallIdentity) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.status !== "pending") {
        await this.repairAudit(current);
        return { record: current, acquired: false } as const;
      }
      const now = new Date(this.now()).toISOString();
      const executing = browserToolCallRecordSchema.parse({
        ...current,
        status: "executing",
        executingAt: now,
        updatedAt: now,
      });
      await atomicWriteJson(this.recordPath(identity), executing, browserToolCallRecordSchema, { mode: 0o600 });
      await this.repairAudit(executing);
      return { record: executing, acquired: true } as const;
    });
  }

  async complete(identity: BrowserToolCallIdentity, response: DynamicToolCallResponse) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.status === "completed") {
        if (JSON.stringify(current.response) !== JSON.stringify(response)) {
          throw new BrowserToolCallStoreError("BROWSER_TOOL_REPLAY_CONFLICT", "Browser tool result changed during replay.");
        }
        await this.repairAudit(current);
        return current;
      }
      const completed = browserToolCallRecordSchema.parse({
        ...current,
        status: "completed",
        response,
        updatedAt: new Date(this.now()).toISOString(),
      });
      await atomicWriteJson(this.recordPath(identity), completed, browserToolCallRecordSchema, { mode: 0o600 });
      await this.repairAudit(completed);
      return completed;
    });
  }

  async readAudit(limit = 1_000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_AUDIT_LIMIT_INVALID", "Browser audit limit is invalid.");
    }
    await this.prepare();
    return this.audit.read({ limit });
  }
}
