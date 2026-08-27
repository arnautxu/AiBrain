import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { readRegularFileWithin } from "@/security/safe-file";
import { atomicWriteJson } from "@/storage/atomic-file";
import { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectInteger,
  expectString,
  parseJson,
} from "@/storage/schema";

export const LOCAL_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCAL_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCAL_SESSION_RENEWAL_MS = 24 * 60 * 60 * 1000;

export type LocalSessionRecord = {
  schemaVersion: 1;
  sessionIdHash: string;
  installationId: string;
  userId: string;
  issuedAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
};

export type CreatedLocalSession = {
  sessionId: string;
  record: LocalSessionRecord;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_FILE_MAX_BYTES = 16 * 1024;

export const localSessionSchema = defineVersionedSchema<LocalSessionRecord>({
  name: "LocalSession",
  schemaVersion: 1,
  keys: [
    "sessionIdHash",
    "installationId",
    "userId",
    "issuedAt",
    "lastSeenAt",
    "idleExpiresAt",
    "absoluteExpiresAt",
  ],
  parse(record, context) {
    const issuedAt = expectInteger(record.issuedAt, context.at("issuedAt"), { minimum: 0 });
    const lastSeenAt = expectInteger(record.lastSeenAt, context.at("lastSeenAt"), { minimum: issuedAt });
    const idleExpiresAt = expectInteger(record.idleExpiresAt, context.at("idleExpiresAt"), {
      minimum: lastSeenAt + 1,
    });
    const absoluteExpiresAt = expectInteger(
      record.absoluteExpiresAt,
      context.at("absoluteExpiresAt"),
      { minimum: issuedAt + 1 },
    );
    if (idleExpiresAt > absoluteExpiresAt) {
      context.at("idleExpiresAt").fail("cannot be later than absoluteExpiresAt");
    }
    return {
      schemaVersion: 1,
      sessionIdHash: expectString(record.sessionIdHash, context.at("sessionIdHash"), {
        minLength: 64,
        maxLength: 64,
        pattern: HASH_PATTERN,
      }),
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
      issuedAt,
      lastSeenAt,
      idleExpiresAt,
      absoluteExpiresAt,
    };
  },
});

function hashSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export class FileLocalSessionStore {
  readonly rootDirectory: string;
  readonly recordsDirectory: string;
  private readonly lockManager: ResourceLockManager;
  private readonly now: () => number;
  private readonly createSessionId: () => string;

  constructor(options: {
    rootDirectory: string;
    now?: () => number;
    createSessionId?: () => string;
  }) {
    if (!path.isAbsolute(options.rootDirectory)) {
      throw new Error("Local session root must be absolute.");
    }
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.recordsDirectory = path.join(this.rootDirectory, "records");
    this.lockManager = new ResourceLockManager({
      rootDirectory: path.join(this.rootDirectory, "locks"),
    });
    this.now = options.now ?? Date.now;
    this.createSessionId = options.createSessionId ?? (() => randomBytes(32).toString("base64url"));
  }

  private recordPathFromHash(sessionIdHash: string) {
    if (!HASH_PATTERN.test(sessionIdHash)) throw new Error("Local session hash is invalid.");
    return path.join(this.recordsDirectory, `${sessionIdHash}.json`);
  }

  private sessionHash(sessionId: string) {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Local session id is invalid.");
    return hashSessionId(sessionId);
  }

  private async readByHash(sessionIdHash: string) {
    const relativePath = `${sessionIdHash}.json`;
    try {
      const contents = await readRegularFileWithin(
        this.recordsDirectory,
        relativePath,
        SESSION_FILE_MAX_BYTES,
      );
      const record = parseJson(localSessionSchema, contents.toString("utf8"), relativePath);
      if (record.sessionIdHash !== sessionIdHash) {
        throw new Error("Local session file does not match its filename.");
      }
      return record;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async create(installationId: string, userId: string): Promise<CreatedLocalSession> {
    if (!INSTALLATION_ID_PATTERN.test(installationId)) throw new Error("Installation id is invalid.");
    if (!USER_ID_PATTERN.test(userId)) throw new Error("Local user id is invalid.");
    const sessionId = this.createSessionId();
    const sessionIdHash = this.sessionHash(sessionId);
    const now = this.now();
    const absoluteExpiresAt = now + LOCAL_SESSION_ABSOLUTE_MS;
    const record: LocalSessionRecord = {
      schemaVersion: 1,
      sessionIdHash,
      installationId,
      userId,
      issuedAt: now,
      lastSeenAt: now,
      idleExpiresAt: Math.min(now + LOCAL_SESSION_IDLE_MS, absoluteExpiresAt),
      absoluteExpiresAt,
    };
    await this.lockManager.withLock(`session:${sessionIdHash}`, async () => {
      if (await this.readByHash(sessionIdHash)) throw new Error("Local session id collision.");
      await atomicWriteJson(this.recordPathFromHash(sessionIdHash), record, localSessionSchema);
    });
    return { sessionId, record };
  }

  async read(
    sessionId: string,
    expectedInstallationId: string,
  ): Promise<{ record: LocalSessionRecord; renewed: boolean } | null> {
    let sessionIdHash: string;
    try {
      sessionIdHash = this.sessionHash(sessionId);
    } catch {
      return null;
    }
    return this.lockManager.withLock(`session:${sessionIdHash}`, async () => {
      const record = await this.readByHash(sessionIdHash);
      if (!record || record.installationId !== expectedInstallationId) return null;
      const now = this.now();
      if (record.absoluteExpiresAt <= now || record.idleExpiresAt <= now) {
        await unlink(this.recordPathFromHash(sessionIdHash)).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
        return null;
      }
      if (now - record.lastSeenAt < LOCAL_SESSION_RENEWAL_MS) {
        return { record, renewed: false };
      }
      const renewed: LocalSessionRecord = {
        ...record,
        lastSeenAt: now,
        idleExpiresAt: Math.min(now + LOCAL_SESSION_IDLE_MS, record.absoluteExpiresAt),
      };
      await atomicWriteJson(this.recordPathFromHash(sessionIdHash), renewed, localSessionSchema);
      return { record: renewed, renewed: true };
    });
  }

  async delete(sessionId: string) {
    let sessionIdHash: string;
    try {
      sessionIdHash = this.sessionHash(sessionId);
    } catch {
      return false;
    }
    return this.lockManager.withLock(`session:${sessionIdHash}`, async () => {
      try {
        await unlink(this.recordPathFromHash(sessionIdHash));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    });
  }

  async revokeUser(installationId: string, userId: string) {
    await mkdir(this.recordsDirectory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.recordsDirectory, { withFileTypes: true });
    let revoked = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
      const sessionIdHash = entry.name.slice(0, -5);
      await this.lockManager.withLock(`session:${sessionIdHash}`, async () => {
        const record = await this.readByHash(sessionIdHash);
        if (record?.installationId !== installationId || record.userId !== userId) return;
        await unlink(this.recordPathFromHash(sessionIdHash));
        revoked += 1;
      });
    }
    return revoked;
  }
}
