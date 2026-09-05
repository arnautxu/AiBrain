import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import {
  assertBrowserApprovalEvidence,
  type BrowserActionResourceSnapshot,
  type BrowserInformedApprovalEvidence,
} from "@/runtime/browser/action-evidence";
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
  recoverAtomicJsonFile,
  type StorageSchema,
} from "@/storage";
import { BROWSER_RUNTIME_CAPABILITIES } from "@/runtime/browser/capabilities";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_AUDIT_EVENTS = 100_000;
const DEFAULT_MAX_RECORDS = 100_000;
const DEFAULT_MAX_RECORD_BYTES = 2 * 1024 * 1024 * 1024;
const RECORD_FILE = /^[0-9a-f]{64}\.json$/u;
const EXECUTION_OWNER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const browserToolGlobal = globalThis as typeof globalThis & { __aibrainBrowserToolExecutionOwner?: string };
const PROCESS_EXECUTION_OWNER = browserToolGlobal.__aibrainBrowserToolExecutionOwner ?? randomUUID();
browserToolGlobal.__aibrainBrowserToolExecutionOwner = PROCESS_EXECUTION_OWNER;

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
  schemaVersion: 2;
  status: "pending" | "executing" | "completed" | "indeterminate";
  response: DynamicToolCallResponse | null;
  approvalEvidence: BrowserInformedApprovalEvidence | null;
  approvalResource: BrowserActionResourceSnapshot | null;
  approvalRequestedAt: string | null;
  approvalResolvedAt: string | null;
  executingAt: string | null;
  executionOwnerId: string | null;
  createdAt: string;
  updatedAt: string;
};

type BrowserToolAuditEvent = {
  schemaVersion: 2;
  callIdentityHash: string;
  tool: string;
  status: "reserved" | "approval_requested" | "approval_resolved" | "executing" | "completed" | "indeterminate";
  success: boolean | null;
  permissionFingerprint: string;
  evidenceFingerprint: string | null;
  actor: "agent";
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

function expectBrowserTool(value: unknown, context: ValidationContext) {
  return expectOneOf(value, BROWSER_RUNTIME_CAPABILITIES.agentTools, context);
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

function failureResponse(): DynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{
      type: "inputText",
      text: "This browser action has an indeterminate prior result and was not replayed.",
    }],
  };
}

function parseApprovalResource(value: unknown, context: ValidationContext): BrowserActionResourceSnapshot {
  const record = expectStrictRecord(value, [
    "kind", "origin", "sanitizedUrl", "scopeId", "generation", "version", "locatorHash", "locatorSummary",
  ], context);
  return {
    kind: expectLiteral(record.kind, "browser-page", context.at("kind")),
    origin: expectString(record.origin, context.at("origin"), { minLength: 1, maxLength: 1_200 }),
    sanitizedUrl: expectString(record.sanitizedUrl, context.at("sanitizedUrl"), { minLength: 1, maxLength: 1_200 }),
    scopeId: expectString(record.scopeId, context.at("scopeId"), { minLength: 1, maxLength: 256 }),
    generation: (() => {
      if (!Number.isSafeInteger(record.generation) || (record.generation as number) < 1) {
        return context.at("generation").fail("expected a positive safe integer");
      }
      return record.generation as number;
    })(),
    version: expectString(record.version, context.at("version"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
    locatorHash: expectString(record.locatorHash, context.at("locatorHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
    locatorSummary: expectString(record.locatorSummary, context.at("locatorSummary"), { minLength: 1, maxLength: 2_000 }),
  };
}

const browserToolCallRecordV2Schema = defineVersionedSchema<BrowserToolCallRecord>({
  name: "BrowserToolCallRecord",
  schemaVersion: 2,
  keys: [
    "installationId", "userId", "threadId", "turnId", "callId", "tool",
    "argumentsHash", "permissionFingerprint", "status", "response", "approvalEvidence", "approvalResource", "approvalRequestedAt",
    "approvalResolvedAt", "executingAt", "executionOwnerId", "createdAt", "updatedAt",
  ],
  parse(record, context) {
    const parsed: BrowserToolCallRecord = {
      schemaVersion: 2,
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
      tool: expectBrowserTool(record.tool, context.at("tool")),
      argumentsHash: expectString(record.argumentsHash, context.at("argumentsHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      permissionFingerprint: expectString(record.permissionFingerprint, context.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      status: expectOneOf(record.status, ["pending", "executing", "completed", "indeterminate"] as const, context.at("status")),
      response: record.response === null ? null : parseResponse(record.response, context.at("response")),
      approvalEvidence: record.approvalEvidence === null ? null : (() => {
        try {
          return assertBrowserApprovalEvidence(record.approvalEvidence);
        } catch (error) {
          return context.at("approvalEvidence").fail("invalid browser approval evidence", error);
        }
      })(),
      approvalResource: record.approvalResource === null
        ? null : parseApprovalResource(record.approvalResource, context.at("approvalResource")),
      approvalRequestedAt: record.approvalRequestedAt === null
        ? null : expectIsoDate(record.approvalRequestedAt, context.at("approvalRequestedAt")),
      approvalResolvedAt: record.approvalResolvedAt === null
        ? null : expectIsoDate(record.approvalResolvedAt, context.at("approvalResolvedAt")),
      executingAt: record.executingAt === null
        ? null : expectIsoDate(record.executingAt, context.at("executingAt")),
      executionOwnerId: record.executionOwnerId === null
        ? null : expectString(record.executionOwnerId, context.at("executionOwnerId"), {
          minLength: 36, maxLength: 36, pattern: EXECUTION_OWNER_PATTERN,
        }),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
      updatedAt: expectIsoDate(record.updatedAt, context.at("updatedAt")),
    };
    if ((parsed.status === "completed" || parsed.status === "indeterminate") !== (parsed.response !== null)) {
      context.at("response").fail("must exist only for completed or indeterminate calls");
    }
    if (parsed.approvalResolvedAt && !parsed.approvalRequestedAt) {
      context.at("approvalResolvedAt").fail("requires approvalRequestedAt");
    }
    if ((parsed.status === "executing" || parsed.status === "indeterminate") &&
      parsed.executingAt === null) {
      context.at("executingAt").fail("is required after execution starts");
    }
    if ((parsed.status === "executing" || parsed.status === "indeterminate") && parsed.executionOwnerId === null) {
      context.at("executionOwnerId").fail("is required after execution starts");
    }
    if (parsed.approvalEvidence && (parsed.approvalEvidence.installationId !== parsed.installationId ||
      parsed.approvalEvidence.userId !== parsed.userId || parsed.approvalEvidence.threadId !== parsed.threadId ||
      parsed.approvalEvidence.turnId !== parsed.turnId || parsed.approvalEvidence.callId !== parsed.callId ||
      parsed.approvalEvidence.actionKind !== parsed.tool ||
      parsed.approvalEvidence.permissionFingerprint !== parsed.permissionFingerprint ||
      parsed.approvalEvidence.request.argsHash !== parsed.argumentsHash)) {
      context.at("approvalEvidence").fail("does not match browser tool call identity");
    }
    if ((parsed.approvalEvidence === null) !== (parsed.approvalResource === null)) {
      context.at("approvalResource").fail("must be bound together with approvalEvidence");
    }
    if (parsed.approvalEvidence && parsed.approvalResource &&
      (parsed.approvalEvidence.resource.kind !== parsed.approvalResource.kind ||
        parsed.approvalEvidence.resource.origin !== parsed.approvalResource.origin ||
        parsed.approvalEvidence.resource.scopeId !== parsed.approvalResource.scopeId ||
        parsed.approvalEvidence.resource.generation !== parsed.approvalResource.generation ||
        parsed.approvalEvidence.resource.version !== parsed.approvalResource.version ||
        parsed.approvalEvidence.resource.locatorHash !== parsed.approvalResource.locatorHash)) {
      context.at("approvalResource").fail("does not match approvalEvidence");
    }
    if (parsed.updatedAt < parsed.createdAt) context.at("updatedAt").fail("must not precede createdAt");
    return parsed;
  },
});

type LegacyBrowserToolCallRecord = BrowserToolCallIdentity & {
  schemaVersion: 1;
  status: "pending" | "executing" | "completed";
  response: DynamicToolCallResponse | null;
  approvalRequestedAt: string | null;
  approvalResolvedAt: string | null;
  executingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const browserToolCallRecordV1Schema = defineVersionedSchema<LegacyBrowserToolCallRecord>({
  name: "BrowserToolCallRecordV1",
  schemaVersion: 1,
  keys: [
    "installationId", "userId", "threadId", "turnId", "callId", "tool",
    "argumentsHash", "permissionFingerprint", "status", "response", "approvalRequestedAt",
    "approvalResolvedAt", "executingAt", "createdAt", "updatedAt",
  ],
  parse(record, context) {
    const parsed: LegacyBrowserToolCallRecord = {
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
      tool: expectBrowserTool(record.tool, context.at("tool")),
      argumentsHash: expectString(record.argumentsHash, context.at("argumentsHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      permissionFingerprint: expectString(record.permissionFingerprint, context.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      status: expectOneOf(record.status, ["pending", "executing", "completed"] as const, context.at("status")),
      response: record.response === null ? null : parseResponse(record.response, context.at("response")),
      approvalRequestedAt: record.approvalRequestedAt === null ? null : expectIsoDate(record.approvalRequestedAt, context.at("approvalRequestedAt")),
      approvalResolvedAt: record.approvalResolvedAt === null ? null : expectIsoDate(record.approvalResolvedAt, context.at("approvalResolvedAt")),
      executingAt: record.executingAt === null ? null : expectIsoDate(record.executingAt, context.at("executingAt")),
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

export const browserToolCallRecordSchema: StorageSchema<BrowserToolCallRecord> = {
  name: "BrowserToolCallRecord",
  parse(value: unknown, source = "BrowserToolCallRecord") {
    if (value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).schemaVersion === 2) {
      return browserToolCallRecordV2Schema.parse(value, source);
    }
    const legacy = browserToolCallRecordV1Schema.parse(value, source);
    return {
      ...legacy,
      schemaVersion: 2,
      approvalEvidence: null,
      approvalResource: null,
      executionOwnerId: legacy.status === "executing"
        ? "00000000-0000-4000-8000-000000000000" : null,
    };
  },
};

const browserToolAuditEventSchema: StorageSchema<BrowserToolAuditEvent> = {
  name: "BrowserToolAuditEvent",
  parse(value: unknown, source = "BrowserToolAuditEvent") {
    if (value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).schemaVersion === 1) {
      const legacyContext = new ValidationContext("BrowserToolAuditEvent", source);
      const legacy = expectStrictRecord(value, [
        "schemaVersion", "callIdentityHash", "tool", "status", "success", "permissionFingerprint", "occurredAt",
      ], legacyContext);
      const status = expectOneOf(legacy.status, [
        "reserved", "approval_requested", "approval_resolved", "executing", "completed",
      ] as const, legacyContext.at("status"));
      const success = legacy.success === null ? null
        : typeof legacy.success === "boolean" ? legacy.success : legacyContext.at("success").fail("expected boolean or null");
      if ((status === "completed") !== (success !== null)) {
        legacyContext.at("success").fail("must exist only for completed events");
      }
      return {
        schemaVersion: 2,
        callIdentityHash: expectString(legacy.callIdentityHash, legacyContext.at("callIdentityHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
        tool: expectBrowserTool(legacy.tool, legacyContext.at("tool")),
        status,
        success,
        permissionFingerprint: expectString(legacy.permissionFingerprint, legacyContext.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
        evidenceFingerprint: null,
        actor: "agent",
        occurredAt: expectIsoDate(legacy.occurredAt, legacyContext.at("occurredAt")),
      };
    }
    const context = new ValidationContext("BrowserToolAuditEvent", source);
    const record = expectStrictRecord(value, [
      "schemaVersion", "callIdentityHash", "tool", "status", "success",
      "permissionFingerprint", "evidenceFingerprint", "actor", "occurredAt",
    ], context);
    const status = expectOneOf(record.status, [
      "reserved", "approval_requested", "approval_resolved", "executing", "completed", "indeterminate",
    ] as const, context.at("status"));
    const success = record.success === null
      ? null
      : typeof record.success === "boolean" ? record.success : context.at("success").fail("expected boolean or null");
    if ((status === "completed" || status === "indeterminate") !== (success !== null)) {
      context.at("success").fail("must exist only for terminal events");
    }
    return {
      schemaVersion: expectLiteral(record.schemaVersion, 2, context.at("schemaVersion")),
      callIdentityHash: expectString(record.callIdentityHash, context.at("callIdentityHash"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      tool: expectBrowserTool(record.tool, context.at("tool")),
      status,
      success,
      permissionFingerprint: expectString(record.permissionFingerprint, context.at("permissionFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      evidenceFingerprint: record.evidenceFingerprint === null ? null
        : expectString(record.evidenceFingerprint, context.at("evidenceFingerprint"), { minLength: 64, maxLength: 64, pattern: SHA256_PATTERN }),
      actor: expectLiteral(record.actor, "agent", context.at("actor")),
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
  private readonly maxRecords: number;
  private readonly maxRecordBytes: number;
  private readonly executionOwnerId: string;

  constructor(options: {
    userRoot: string;
    now?: () => number;
    maxRecords?: number;
    maxRecordBytes?: number;
    executionOwnerId?: string;
  }) {
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
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    this.executionOwnerId = options.executionOwnerId ?? PROCESS_EXECUTION_OWNER;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > 1_000_000 ||
      !Number.isSafeInteger(this.maxRecordBytes) || this.maxRecordBytes < 4_096 ||
      this.maxRecordBytes > 16 * 1024 * 1024 * 1024) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_CAPACITY_INVALID", "Browser tool storage capacity is invalid.");
    }
    if (!EXECUTION_OWNER_PATTERN.test(this.executionOwnerId)) {
      throw new BrowserToolCallStoreError("BROWSER_TOOL_OWNER_INVALID", "Browser tool execution owner is invalid.");
    }
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
    evidenceFingerprint: string | null = null,
  ) {
    const event: BrowserToolAuditEvent = {
      schemaVersion: 2,
      callIdentityHash: identityKey(identity),
      tool: identity.tool,
      status,
      success,
      permissionFingerprint: identity.permissionFingerprint,
      evidenceFingerprint,
      actor: "agent",
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
    const evidenceFingerprint = record.approvalEvidence?.evidenceFingerprint ?? null;
    await this.appendAudit(record, "reserved", record.createdAt, null, evidenceFingerprint);
    if (record.approvalRequestedAt) {
      await this.appendAudit(record, "approval_requested", record.approvalRequestedAt, null, evidenceFingerprint);
    }
    if (record.approvalResolvedAt) {
      await this.appendAudit(record, "approval_resolved", record.approvalResolvedAt, null, evidenceFingerprint);
    }
    if (record.executingAt) {
      await this.appendAudit(record, "executing", record.executingAt, null, evidenceFingerprint);
    }
    if (record.status === "completed") {
      await this.appendAudit(record, "completed", record.updatedAt, record.response?.success ?? false, evidenceFingerprint);
    } else if (record.status === "indeterminate") {
      await this.appendAudit(record, "indeterminate", record.updatedAt, false, evidenceFingerprint);
    }
  }

  private async readUnlocked(identity: BrowserToolCallIdentity) {
    const recordPath = this.recordPath(identity);
    try {
      const recovered = await recoverAtomicJsonFile(recordPath, browserToolCallRecordSchema);
      const metadata = await lstat(recordPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool record is unsafe.");
      }
      const record = recovered.value;
      if (!sameIdentity(record, identity)) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_REPLAY_CONFLICT", "Browser tool call identity changed during replay.");
      }
      return record;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async capacityUsage() {
    let records = 0;
    let bytes = 0;
    for (const entry of await readdir(this.recordsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || /[\\/\u0000-\u001f\u007f]/u.test(entry.name)) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool record directory contains an unsafe entry.");
      }
      const metadata = await lstat(path.join(this.recordsRoot, entry.name));
      const wrongOwner = typeof process.getuid === "function" && metadata.uid !== process.getuid();
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        wrongOwner || (metadata.mode & 0o077) !== 0) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_PATH_UNSAFE", "Browser tool record storage is unsafe.");
      }
      if (RECORD_FILE.test(entry.name)) records += 1;
      bytes += metadata.size;
      if (!Number.isSafeInteger(bytes)) {
        throw new BrowserToolCallStoreError("BROWSER_TOOL_CAPACITY", "Browser tool storage size is invalid.");
      }
    }
    return { records, bytes };
  }

  private async writeRecord(record: BrowserToolCallRecord, existing: boolean) {
    const recordPath = this.recordPath(record);
    const nextBytes = Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await this.locks.withLock("browser-tool:capacity", async () => {
      const usage = await this.capacityUsage();
      let previousBytes = 0;
      let present = false;
      try {
        const metadata = await lstat(recordPath);
        present = true;
        previousBytes = metadata.size;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
      if (present !== existing) {
        throw new BrowserToolCallStoreError(
          present ? "BROWSER_TOOL_REPLAY_CONFLICT" : "BROWSER_TOOL_NOT_FOUND",
          "Browser tool record changed during its capacity transaction.",
        );
      }
      const recordCount = usage.records + (present ? 0 : 1);
      const byteCount = usage.bytes - previousBytes + nextBytes;
      if (recordCount > this.maxRecords || byteCount > this.maxRecordBytes) {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_CAPACITY",
          "Browser tool storage reached its safe capacity and requires archival.",
        );
      }
      await atomicWriteJson(recordPath, record, browserToolCallRecordSchema, { mode: 0o600 });
    });
  }

  async begin(identity: BrowserToolCallIdentity) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const existing = await this.readUnlocked(identity);
      if (existing) {
        if (existing.status === "executing" && existing.executionOwnerId !== this.executionOwnerId) {
          const indeterminate = browserToolCallRecordSchema.parse({
            ...existing,
            status: "indeterminate",
            response: failureResponse(),
            updatedAt: new Date(this.now()).toISOString(),
          });
          await this.writeRecord(indeterminate, true);
          await this.repairAudit(indeterminate);
          return indeterminate;
        }
        await this.repairAudit(existing);
        return existing;
      }
      const now = new Date(this.now()).toISOString();
      const record = browserToolCallRecordSchema.parse({
        schemaVersion: 2,
        ...identity,
        status: "pending",
        response: null,
        approvalEvidence: null,
        approvalResource: null,
        approvalRequestedAt: null,
        approvalResolvedAt: null,
        executingAt: null,
        executionOwnerId: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.writeRecord(record, false);
      await this.repairAudit(record);
      return record;
    });
  }

  async bindApprovalEvidence(
    identity: BrowserToolCallIdentity,
    evidenceInput: BrowserInformedApprovalEvidence,
    resource: BrowserActionResourceSnapshot,
  ) {
    const evidence = assertBrowserApprovalEvidence(evidenceInput);
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.approvalEvidence) {
        if (current.approvalEvidence.evidenceFingerprint !== evidence.evidenceFingerprint ||
          JSON.stringify(current.approvalResource) !== JSON.stringify(resource)) {
          throw new BrowserToolCallStoreError(
            "BROWSER_TOOL_REPLAY_CONFLICT",
            "Browser approval evidence changed during replay.",
          );
        }
        await this.repairAudit(current);
        return { record: current, first: false } as const;
      }
      if (current.status !== "pending" || current.approvalRequestedAt || current.approvalResolvedAt) {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_STATE_INVALID",
          "Browser approval evidence cannot be rebound after approval starts.",
        );
      }
      const bound = browserToolCallRecordSchema.parse({
        ...current,
        approvalEvidence: evidence,
        approvalResource: resource,
        updatedAt: new Date(this.now()).toISOString(),
      });
      await this.writeRecord(bound, true);
      await this.repairAudit(bound);
      return { record: bound, first: true } as const;
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
      await this.writeRecord(requested, true);
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
      await this.writeRecord(resolved, true);
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
      const mutation = current.tool === "open" || current.tool === "scroll" ||
        current.tool === "click" || current.tool === "type";
      if (mutation && current.approvalEvidence && !current.approvalResolvedAt) {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_STATE_INVALID",
          "A sensitive browser interaction cannot execute before its bound approval is resolved.",
        );
      }
      if (mutation && !current.approvalEvidence &&
        (current.approvalRequestedAt || current.approvalResolvedAt)) {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_STATE_INVALID",
          "Browser approval timestamps require bound approval evidence.",
        );
      }
      const now = new Date(this.now()).toISOString();
      const executing = browserToolCallRecordSchema.parse({
        ...current,
        status: "executing",
        executingAt: now,
        executionOwnerId: this.executionOwnerId,
        updatedAt: now,
      });
      await this.writeRecord(executing, true);
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
      if (current.status === "indeterminate") {
        if (JSON.stringify(current.response) !== JSON.stringify(response)) {
          throw new BrowserToolCallStoreError("BROWSER_TOOL_REPLAY_CONFLICT", "Browser indeterminate result changed during replay.");
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
      await this.writeRecord(completed, true);
      await this.repairAudit(completed);
      return completed;
    });
  }

  async markIndeterminate(identity: BrowserToolCallIdentity, response: DynamicToolCallResponse) {
    await this.prepare();
    return this.locks.withLock(`browser-tool:${identityKey(identity)}`, async () => {
      const current = await this.readUnlocked(identity);
      if (!current) throw new BrowserToolCallStoreError("BROWSER_TOOL_NOT_FOUND", "Browser tool call was not reserved.");
      if (current.status === "indeterminate") {
        if (JSON.stringify(current.response) !== JSON.stringify(response)) {
          throw new BrowserToolCallStoreError("BROWSER_TOOL_REPLAY_CONFLICT", "Browser indeterminate result changed during replay.");
        }
        await this.repairAudit(current);
        return current;
      }
      if (current.status !== "executing") {
        throw new BrowserToolCallStoreError(
          "BROWSER_TOOL_STATE_INVALID",
          "Only an executing browser call can become indeterminate.",
        );
      }
      const indeterminate = browserToolCallRecordSchema.parse({
        ...current,
        status: "indeterminate",
        response,
        updatedAt: new Date(this.now()).toISOString(),
      });
      await this.writeRecord(indeterminate, true);
      await this.repairAudit(indeterminate);
      return indeterminate;
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
