import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  defineVersionedSchema,
  expectArray,
  expectIsoDate,
  expectString,
  recoverAtomicJsonFile,
  ResourceLockManager,
  ValidationContext,
} from "@/storage";

const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 512;

type BrowserNavigationEntry = {
  threadId: string;
  url: string;
  updatedAt: string;
};

type BrowserNavigationState = {
  schemaVersion: 1;
  installationId: string;
  userId: string;
  entries: BrowserNavigationEntry[];
  createdAt: string;
  updatedAt: string;
};

export class BrowserNavigationStoreError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BrowserNavigationStoreError";
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (code === undefined || (error as NodeJS.ErrnoException).code === code));
}

function parseEntry(value: unknown, context: ValidationContext): BrowserNavigationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) context.fail("expected an object");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("\0") !== ["threadId", "updatedAt", "url"].join("\0")) {
    context.fail("navigation entry keys do not match the contract");
  }
  const url = expectString(record.url, context.at("url"), { minLength: 1, maxLength: 8_192 });
  if (url !== url.trim() || /\p{C}/u.test(url)) context.at("url").fail("expected a normalized URL");
  return {
    threadId: expectString(record.threadId, context.at("threadId"), {
      minLength: 36,
      maxLength: 36,
      pattern: UUID_PATTERN,
    }),
    url,
    updatedAt: expectIsoDate(record.updatedAt, context.at("updatedAt")),
  };
}

const browserNavigationStateSchema = defineVersionedSchema<BrowserNavigationState>({
  name: "BrowserNavigationState",
  schemaVersion: 1,
  keys: ["installationId", "userId", "entries", "createdAt", "updatedAt"],
  parse(record, context) {
    const createdAt = expectIsoDate(record.createdAt, context.at("createdAt"));
    const updatedAt = expectIsoDate(record.updatedAt, context.at("updatedAt"));
    if (updatedAt < createdAt) context.at("updatedAt").fail("must not precede createdAt");
    const entries = expectArray(record.entries, context.at("entries"), parseEntry);
    const threadIds = new Set<string>();
    for (const entry of entries) {
      if (threadIds.has(entry.threadId)) context.at("entries").fail("thread ids must be unique");
      if (entry.updatedAt > updatedAt) context.at("entries").fail("entry timestamp exceeds state timestamp");
      threadIds.add(entry.threadId);
    }
    return {
      schemaVersion: 1,
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2,
        maxLength: 63,
        pattern: INSTALLATION_ID_PATTERN,
      }),
      userId: expectString(record.userId, context.at("userId"), {
        minLength: 36,
        maxLength: 36,
        pattern: UUID_PATTERN,
      }),
      entries,
      createdAt,
      updatedAt,
    };
  },
});

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export class BrowserNavigationStore {
  readonly stateFile: string;
  private readonly lockRoot: string;
  private readonly locks: ResourceLockManager;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(private readonly options: Readonly<{
    browserRoot: string;
    installationId: string;
    userId: string;
    now?: () => number;
    maxEntries?: number;
  }>) {
    if (!path.isAbsolute(options.browserRoot) ||
      !INSTALLATION_ID_PATTERN.test(options.installationId) || !UUID_PATTERN.test(options.userId)) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_CONFIG_INVALID", "Browser navigation store binding is invalid.");
    }
    this.stateFile = path.join(options.browserRoot, "navigation.json");
    this.lockRoot = path.join(options.browserRoot, ".navigation-locks");
    this.locks = new ResourceLockManager({ rootDirectory: this.lockRoot });
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > 4_096) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_CONFIG_INVALID", "Browser navigation retention is invalid.");
    }
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private async prepare() {
    const rootMetadata = await lstat(this.options.browserRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || (rootMetadata.mode & 0o077) !== 0) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_PATH_UNSAFE", "Browser root is unsafe.");
    }
    try {
      await mkdir(this.lockRoot, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    const lockMetadata = await lstat(this.lockRoot);
    const [canonicalRoot, canonicalLocks] = await Promise.all([
      realpath(this.options.browserRoot),
      realpath(this.lockRoot),
    ]);
    if (!lockMetadata.isDirectory() || lockMetadata.isSymbolicLink() ||
      (lockMetadata.mode & 0o077) !== 0 || !inside(canonicalRoot, canonicalLocks)) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_PATH_UNSAFE", "Browser navigation lock root is unsafe.");
    }
    await chmod(this.lockRoot, 0o700);
  }

  private empty(): BrowserNavigationState {
    const now = this.iso();
    return {
      schemaVersion: 1,
      installationId: this.options.installationId,
      userId: this.options.userId,
      entries: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private async readUnlocked() {
    try {
      const metadata = await lstat(this.stateFile);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        metadata.size > MAX_STATE_BYTES || (metadata.mode & 0o077) !== 0) {
        throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_PATH_UNSAFE", "Browser navigation state is unsafe.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      return this.empty();
    }
    const state = (await recoverAtomicJsonFile(this.stateFile, browserNavigationStateSchema)).value;
    if (state.installationId !== this.options.installationId || state.userId !== this.options.userId) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_BINDING_MISMATCH", "Browser navigation state belongs to another user or installation.");
    }
    if (state.entries.length > this.maxEntries) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_CAPACITY", "Browser navigation state exceeds configured retention.");
    }
    return state;
  }

  private async writeUnlocked(state: BrowserNavigationState) {
    const validated = browserNavigationStateSchema.parse(state, this.stateFile);
    if (validated.entries.length > this.maxEntries ||
      Buffer.byteLength(JSON.stringify(validated), "utf8") > MAX_STATE_BYTES) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_CAPACITY", "Browser navigation state exceeds safe retention.");
    }
    await atomicWriteJson(this.stateFile, validated, browserNavigationStateSchema, { mode: 0o600 });
    await chmod(this.stateFile, 0o600);
  }

  async get(threadId: string) {
    if (!UUID_PATTERN.test(threadId)) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_THREAD_INVALID", "Browser navigation thread is invalid.");
    }
    await this.prepare();
    return this.locks.withLock(`browser-navigation:${this.options.installationId}:${this.options.userId}`, async () => {
      const state = await this.readUnlocked();
      return state.entries.find((entry) => entry.threadId === threadId)?.url ?? null;
    });
  }

  async set(threadId: string, url: string) {
    if (!UUID_PATTERN.test(threadId) || url.length < 1 || url.length > 8_192 ||
      url !== url.trim() || /\p{C}/u.test(url)) {
      throw new BrowserNavigationStoreError("BROWSER_NAVIGATION_VALUE_INVALID", "Browser navigation value is invalid.");
    }
    await this.prepare();
    return this.locks.withLock(`browser-navigation:${this.options.installationId}:${this.options.userId}`, async () => {
      const state = await this.readUnlocked();
      const now = this.iso();
      state.entries = state.entries.filter((entry) => entry.threadId !== threadId);
      state.entries.push({ threadId, url, updatedAt: now });
      state.entries = state.entries.slice(-this.maxEntries);
      state.updatedAt = now;
      await this.writeUnlocked(state);
      return url;
    });
  }
}
