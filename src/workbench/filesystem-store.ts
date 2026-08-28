import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import type { ChatMessage } from "@/lib/chat-contract";
import { isActivityItem, isChatMessage } from "@/lib/chat-contract";
import {
  atomicWriteJson,
  defineVersionedSchema,
  expectArray,
  expectInteger,
  expectString,
  readValidatedJson,
  recoverAtomicJsonFile,
  ResourceLockManager,
  type ValidationContext,
} from "@/storage";
import {
  branchHistory,
  publicProject,
  publicThread,
  uniqueSlug,
  type StoredProject,
  type StoredThread,
  type ThreadRuntimeContext,
} from "@/workbench/internal";
import {
  WorkbenchConflictError,
  WorkbenchNotFoundError,
  WorkbenchPersistenceError,
  WorkbenchValidationError,
} from "@/workbench/errors";
import {
  isUuid,
  isBranchThreadInput,
  isProjectName,
  isThreadTitle,
  isUpdateProjectInput,
  isUpdateThreadInput,
  isWorkbenchProject,
  isWorkbenchThread,
  STANDALONE_PROJECT_SLUG,
  WORKBENCH_MAX_CURSOR_LENGTH,
  WORKBENCH_MAX_PAGE_SIZE,
  WORKBENCH_MAX_QUERY_LENGTH,
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchListQuery,
  type WorkbenchPage,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchThread,
  type WorkbenchThreadSummary,
} from "@/workbench/types";
import { FileTurnProjectionStore } from "@/workbench/turn-projection-store";

const WORKBENCH_SCHEMA_VERSION = 1 as const;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const WORKSPACE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_STATE_BYTES = 64 * 1024 * 1024;

const PROJECT_KEYS = [
  "id",
  "name",
  "slug",
  "status",
  "pinned",
  "instructions",
  "sources",
  "memory",
  "sharing",
  "workspace",
  "createdAt",
  "updatedAt",
  "workspaceKey",
] as const;
const LEGACY_PROJECT_KEYS = PROJECT_KEYS.filter((key) =>
  !["instructions", "sources", "memory", "sharing"].includes(key));
const WORKSPACE_KEYS = ["id", "label", "hostType", "status", "isPrimary"] as const;
const THREAD_KEYS = [
  "id",
  "projectId",
  "title",
  "status",
  "pinned",
  "createdAt",
  "updatedAt",
  "messages",
  "runtimeThreadToken",
] as const;
const THREAD_OPTIONAL_KEYS = ["lineage"] as const;
const MESSAGE_KEYS = [
  "id",
  "role",
  "content",
  "createdAt",
  "status",
  "activity",
  "plan",
  "approvals",
  "diff",
  "attachments",
  "artifacts",
] as const;

type WorkbenchState = {
  schemaVersion: typeof WORKBENCH_SCHEMA_VERSION;
  installationId: string;
  userId: string;
  revision: number;
  projects: StoredProject[];
  threads: StoredThread[];
};

type PageCursor = {
  schemaVersion: 1;
  queryFingerprint: string;
  pinned: boolean;
  updatedAt: string;
  id: string;
};

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!isPlainRecord(value)) return false;
  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key)) &&
    optional.every((key) => !requiredSet.has(key));
}

function isCanonicalIsoDate(value: unknown) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function hasExactArtifactKeys(value: ChatMessage["artifacts"][number]) {
  if (value.type === "image") {
    return hasExactKeys(value, ["id", "type", "name", "url", "prompt"]);
  }
  if (value.type === "document") {
    return hasExactKeys(value, [
      "id", "type", "name", "url", "kind", "mimeType", "size", "status", "pages",
      "previewUrl", "publicationStatus", "publicationError", "targetLabel", "error",
    ]);
  }
  return hasExactKeys(value, [
    "id", "type", "name", "status", "control", "viewerUrl", "captureUrl", "downloadUrl", "error",
  ]);
}

function isStrictChatMessage(value: unknown): value is ChatMessage {
  if (!hasExactKeys(value, MESSAGE_KEYS, ["sources", "toolResults"]) || !isChatMessage(value)) return false;
  if (!isUuid(value.id)) return false;
  if (!isCanonicalIsoDate(value.createdAt)) return false;
  if (!value.activity.every((item) =>
    hasExactKeys(item, ["id", "kind", "label", "status"], ["detail", "output", "files"]))) return false;
  if (!value.plan.every((item) => hasExactKeys(item, ["step", "status"]))) return false;
  if (!value.approvals.every((item) =>
    hasExactKeys(
      item,
      ["id", "threadId", "turnId", "itemId", "kind", "title", "detail", "status"],
      ["command", "cwd", "permissionFingerprint"],
    ))) return false;
  if (!value.attachments.every((item) =>
    hasExactKeys(item, ["id", "name", "mimeType", "size"]))) return false;
  if (!(value.sources ?? []).every((item) =>
    hasExactKeys(item, ["id", "kind", "title", "url", "domain", "snippet", "publishedAt"]))) return false;
  if (!(value.toolResults ?? []).every((item) =>
    hasExactKeys(item, ["id", "kind", "title", "status", "summary", "output", "sourceIds", "createdAt"]))) return false;
  return value.artifacts.every(hasExactArtifactKeys);
}

function parseProject(value: unknown, context: ValidationContext): StoredProject {
  const record = isPlainRecord(value) ? value : null;
  const upgraded = record ? {
    ...record,
    instructions: record.instructions ?? "",
    sources: record.sources ?? [],
    memory: record.memory ?? { enabled: true, notes: "", updatedAt: null },
    sharing: record.sharing ?? { visibility: "private", members: [] },
  } : value;
  if (
    !hasExactKeys(value, LEGACY_PROJECT_KEYS, ["instructions", "sources", "memory", "sharing"]) ||
    !hasExactKeys(record?.workspace, WORKSPACE_KEYS) ||
    !isWorkbenchProject(upgraded) ||
    typeof record?.workspaceKey !== "string" ||
    !WORKSPACE_KEY_PATTERN.test(record.workspaceKey) ||
    !isCanonicalIsoDate(upgraded.createdAt) ||
    !isCanonicalIsoDate(upgraded.updatedAt)
  ) {
    context.fail("expected a strict stored project");
  }
  if (Date.parse(upgraded.updatedAt) < Date.parse(upgraded.createdAt)) {
    context.at("updatedAt").fail("must not precede createdAt");
  }
  return upgraded as StoredProject;
}

function parseThread(value: unknown, context: ValidationContext): StoredThread {
  const record = isPlainRecord(value) ? value : null;
  const runtimeThreadToken = record?.runtimeThreadToken;
  if (
    !hasExactKeys(value, THREAD_KEYS, THREAD_OPTIONAL_KEYS) ||
    !isWorkbenchThread(value) ||
    !isCanonicalIsoDate(value.createdAt) ||
    !isCanonicalIsoDate(value.updatedAt) ||
    !value.messages.every(isStrictChatMessage) ||
    !(runtimeThreadToken === null || (
      typeof runtimeThreadToken === "string" &&
      runtimeThreadToken.length > 0 &&
      runtimeThreadToken.length <= 1_024 &&
      !/\p{C}/u.test(runtimeThreadToken)
    ))
  ) {
    context.fail("expected a strict stored thread");
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    context.at("updatedAt").fail("must not precede createdAt");
  }
  const messageIds = new Set<string>();
  for (const message of value.messages) {
    if (messageIds.has(message.id)) context.at("messages").fail("message ids must be unique");
    messageIds.add(message.id);
  }
  return value as StoredThread;
}

const workbenchStateSchema = defineVersionedSchema<WorkbenchState>({
  name: "FileWorkbenchState",
  schemaVersion: WORKBENCH_SCHEMA_VERSION,
  keys: ["installationId", "userId", "revision", "projects", "threads"],
  parse(record, context) {
    const projects = expectArray(
      record.projects,
      context.at("projects"),
      (project, itemContext) => parseProject(project, itemContext),
    );
    const threads = expectArray(
      record.threads,
      context.at("threads"),
      (thread, itemContext) => parseThread(thread, itemContext),
    );
    const projectIds = new Set<string>();
    const slugs = new Set<string>();
    const workspaceIds = new Set<string>();
    const workspaceKeys = new Set<string>();
    for (const project of projects) {
      if (projectIds.has(project.id)) context.at("projects").fail("project ids must be unique");
      if (slugs.has(project.slug)) context.at("projects").fail("project slugs must be unique");
      if (workspaceIds.has(project.workspace.id)) context.at("projects").fail("workspace ids must be unique");
      if (workspaceKeys.has(project.workspaceKey)) context.at("projects").fail("workspace keys must be unique");
      projectIds.add(project.id);
      slugs.add(project.slug);
      workspaceIds.add(project.workspace.id);
      workspaceKeys.add(project.workspaceKey);
    }
    const threadIds = new Set<string>();
    for (const thread of threads) {
      if (threadIds.has(thread.id)) context.at("threads").fail("thread ids must be unique");
      if (!projectIds.has(thread.projectId)) context.at("threads").fail("thread references an unknown project");
      threadIds.add(thread.id);
    }
    return {
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
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
      revision: expectInteger(record.revision, context.at("revision"), { minimum: 0 }),
      projects,
      threads,
    };
  },
});

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertUserId(userId: string) {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new WorkbenchNotFoundError("Identificador d’usuari no vàlid.");
  }
}

async function assertSecureDirectory(directory: string, label: string) {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new WorkbenchNotFoundError(`${label} no està provisionat.`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new WorkbenchPersistenceError(`${label} no és un directori segur.`);
  }
}

function newState(installationId: string, userId: string): WorkbenchState {
  return {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    installationId,
    userId,
    revision: 0,
    projects: [],
    threads: [],
  };
}

function newProject(name: string, slug: string): StoredProject {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: name.trim(),
    slug,
    status: "active",
    pinned: false,
    instructions: "",
    sources: [],
    memory: { enabled: true, notes: "", updatedAt: null },
    sharing: { visibility: "private", members: [] },
    workspace: {
      id: randomUUID(),
      label: name.trim(),
      hostType: "managed",
      status: "ready",
      isPrimary: true,
    },
    workspaceKey: `project-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ca");
}

function compareListItems(
  left: Pick<WorkbenchProject, "pinned" | "updatedAt" | "id">,
  right: Pick<WorkbenchProject, "pinned" | "updatedAt" | "id">,
) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  return updated || left.id.localeCompare(right.id);
}

function queryFingerprint(query: WorkbenchListQuery, scope: string) {
  return createHash("sha256")
    .update(JSON.stringify({ scope, status: query.status, query: query.query ?? null }))
    .digest("base64url")
    .slice(0, 16);
}

function encodePageCursor(
  item: Pick<WorkbenchProject, "pinned" | "updatedAt" | "id">,
  fingerprint: string,
) {
  const cursor: PageCursor = {
    schemaVersion: 1,
    queryFingerprint: fingerprint,
    pinned: item.pinned,
    updatedAt: item.updatedAt,
    id: item.id,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePageCursor(value: string): PageCursor {
  let decoded: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value || bytes.byteLength > 256) throw new Error("non-canonical cursor");
    decoded = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new WorkbenchValidationError("El cursor de paginació no és vàlid.", { cause: error });
  }
  if (
    !isPlainRecord(decoded) ||
    !hasExactKeys(decoded, ["schemaVersion", "queryFingerprint", "pinned", "updatedAt", "id"]) ||
    decoded.schemaVersion !== 1 || typeof decoded.pinned !== "boolean" ||
    typeof decoded.queryFingerprint !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(decoded.queryFingerprint) ||
    !isCanonicalIsoDate(decoded.updatedAt) || !isUuid(decoded.id)
  ) {
    throw new WorkbenchValidationError("El cursor de paginació no és vàlid.");
  }
  return decoded as PageCursor;
}

function paginate<Item extends Pick<WorkbenchProject, "pinned" | "updatedAt" | "id">>(
  items: Item[],
  query: WorkbenchListQuery,
  scope: string,
): WorkbenchPage<Item> {
  const sorted = [...items].sort(compareListItems);
  const fingerprint = queryFingerprint(query, scope);
  let start = 0;
  if (query.cursor) {
    const cursor = decodePageCursor(query.cursor);
    if (cursor.queryFingerprint !== fingerprint) {
      throw new WorkbenchValidationError("El cursor no pertany a aquesta consulta.");
    }
    const cursorIndex = sorted.findIndex((item) =>
      item.id === cursor.id && item.pinned === cursor.pinned && item.updatedAt === cursor.updatedAt);
    if (cursorIndex === -1) {
      throw new WorkbenchValidationError("El cursor ha caducat o no pertany a aquesta consulta.");
    }
    start = cursorIndex + 1;
  }
  const pageItems = sorted.slice(start, start + query.limit);
  return {
    items: pageItems,
    nextCursor: start + pageItems.length < sorted.length && pageItems.length > 0
      ? encodePageCursor(pageItems[pageItems.length - 1], fingerprint)
      : null,
  };
}

function threadSummary(thread: StoredThread): WorkbenchThreadSummary {
  const visible = publicThread(thread);
  const { messages: _messages, ...summary } = visible;
  return {
    ...summary,
    messageCount: thread.messages.length,
    lastMessageAt: thread.messages.at(-1)?.createdAt ?? null,
  };
}

function assertListQuery(query: WorkbenchListQuery) {
  if (
    !isPlainRecord(query) ||
    !hasExactKeys(query, ["status", "limit"], ["query", "cursor"]) ||
    !(query.status === "active" || query.status === "archived" || query.status === "all") ||
    !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > WORKBENCH_MAX_PAGE_SIZE ||
    (query.query !== undefined && (
      typeof query.query !== "string" || query.query.length < 1 ||
      query.query.length > WORKBENCH_MAX_QUERY_LENGTH || query.query !== query.query.trim() ||
      /\p{C}/u.test(query.query)
    )) ||
    (query.cursor !== undefined && (
      typeof query.cursor !== "string" || query.cursor.length < 1 ||
      query.cursor.length > WORKBENCH_MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(query.cursor)
    ))
  ) {
    throw new WorkbenchValidationError("La consulta del workbench no és vàlida.");
  }
}

function snapshot(state: WorkbenchState): WorkbenchSnapshot {
  return {
    persistence: "filesystem",
    projects: state.projects.map(publicProject),
    threads: state.threads.map(publicThread),
  };
}

export type FileWorkbenchStoreOptions = {
  installationId: string;
  usersRoot: string;
};

/**
 * Durable workbench state scoped to one installation and one authenticated user.
 * User roots must already have been provisioned by the local user/worker flow.
 */
export class FileWorkbenchStore {
  readonly installationId: string;
  readonly usersRoot: string;

  constructor(options: FileWorkbenchStoreOptions) {
    if (!INSTALLATION_ID_PATTERN.test(options.installationId)) {
      throw new WorkbenchPersistenceError("Identificador d’instal·lació no vàlid.");
    }
    if (!path.isAbsolute(options.usersRoot)) {
      throw new WorkbenchPersistenceError("La ruta d’usuaris ha de ser absoluta.");
    }
    this.installationId = options.installationId;
    this.usersRoot = path.resolve(options.usersRoot);
  }

  static fromInstallation(config: Readonly<InstallationConfig>) {
    return new FileWorkbenchStore({
      installationId: config.installationId,
      usersRoot: config.paths.usersRoot,
    });
  }

  private paths(userId: string) {
    assertUserId(userId);
    const userRoot = path.resolve(this.usersRoot, userId);
    if (userRoot === this.usersRoot || !inside(this.usersRoot, userRoot)) {
      throw new WorkbenchPersistenceError("La ruta de workbench surt de usersRoot.");
    }
    const stateRoot = path.join(userRoot, "state");
    return {
      userRoot,
      stateRoot,
      statePath: path.join(stateRoot, "workbench.json"),
      lockRoot: path.join(stateRoot, ".locks"),
    };
  }

  private async prepare(userId: string) {
    const paths = this.paths(userId);
    await assertSecureDirectory(this.usersRoot, "El directori d’usuaris");
    await assertSecureDirectory(paths.userRoot, "L’usuari");
    try {
      await mkdir(paths.stateRoot, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertSecureDirectory(paths.stateRoot, "L’estat de l’usuari");
    await chmod(paths.stateRoot, 0o700);
    try {
      await mkdir(paths.lockRoot, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertSecureDirectory(paths.lockRoot, "Els locks del workbench");
    await chmod(paths.lockRoot, 0o700);

    const [canonicalUsersRoot, canonicalUserRoot, canonicalStateRoot, canonicalLockRoot] = await Promise.all([
      realpath(this.usersRoot),
      realpath(paths.userRoot),
      realpath(paths.stateRoot),
      realpath(paths.lockRoot),
    ]);
    if (
      canonicalUserRoot === canonicalUsersRoot ||
      !inside(canonicalUsersRoot, canonicalUserRoot) ||
      !inside(canonicalUserRoot, canonicalStateRoot) ||
      !inside(canonicalStateRoot, canonicalLockRoot)
    ) {
      throw new WorkbenchPersistenceError("La ruta de workbench resol fora de l’usuari.");
    }
    return paths;
  }

  private lockManager(lockRoot: string) {
    return new ResourceLockManager({ rootDirectory: lockRoot });
  }

  private async assertStateFileSafe(statePath: string) {
    try {
      const metadata = await lstat(statePath);
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
        throw new WorkbenchPersistenceError("L’estat del workbench no és un fitxer regular segur.");
      }
      if (metadata.size > MAX_STATE_BYTES) {
        throw new WorkbenchPersistenceError("L’estat del workbench supera el límit operatiu segur.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  private async readUnlocked(userId: string, statePath: string) {
    await this.assertStateFileSafe(statePath);
    let state: WorkbenchState;
    try {
      state = (await recoverAtomicJsonFile(statePath, workbenchStateSchema)).value;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      state = newState(this.installationId, userId);
      await this.writeUnlocked(statePath, state);
    }
    if (state.installationId !== this.installationId || state.userId !== userId) {
      throw new WorkbenchPersistenceError("L’estat del workbench no pertany a aquesta instal·lació i usuari.");
    }
    const projections = new FileTurnProjectionStore({
      installationId: this.installationId,
      userId,
      usersRoot: this.usersRoot,
    });
    for (const thread of state.threads) {
      for (let index = 0; index < thread.messages.length; index += 1) {
        const message = thread.messages[index];
        if (message.role !== "assistant" || message.status !== "streaming") continue;
        const projection = await projections.read(thread.id, message.id);
        if (!projection) continue;
        thread.messages[index] = projection.message;
        if (projection.runtimeThreadToken) thread.runtimeThreadToken = projection.runtimeThreadToken;
        if (projection.updatedAt > thread.updatedAt) thread.updatedAt = projection.updatedAt;
      }
    }
    return state;
  }

  private async writeUnlocked(statePath: string, state: WorkbenchState) {
    const validated = workbenchStateSchema.parse(state, statePath);
    if (Buffer.byteLength(JSON.stringify(validated), "utf8") > MAX_STATE_BYTES) {
      throw new WorkbenchPersistenceError("L’estat del workbench supera el límit operatiu segur.");
    }
    await atomicWriteJson(statePath, validated, workbenchStateSchema);
  }

  private async read(userId: string) {
    const paths = await this.prepare(userId);
    return this.lockManager(paths.lockRoot).withLock(
      `workbench:${this.installationId}:${userId}`,
      () => this.readUnlocked(userId, paths.statePath),
    );
  }

  private async mutate<Result>(
    userId: string,
    operation: (state: WorkbenchState) => Result | Promise<Result>,
  ) {
    const paths = await this.prepare(userId);
    return this.lockManager(paths.lockRoot).withLock(
      `workbench:${this.installationId}:${userId}`,
      async () => {
        const state = await this.readUnlocked(userId, paths.statePath);
        const result = await operation(state);
        state.revision += 1;
        await this.writeUnlocked(paths.statePath, state);
        return result;
      },
    );
  }

  async load(userId: string): Promise<WorkbenchSnapshot> {
    let state = await this.read(userId);
    if (!state.projects.some((project) => project.slug === STANDALONE_PROJECT_SLUG)) {
      await this.mutate(userId, (current) => {
        if (current.projects.some((project) => project.slug === STANDALONE_PROJECT_SLUG)) return;
        current.projects.push(newProject("Conversaciones", STANDALONE_PROJECT_SLUG));
      });
      state = await this.read(userId);
    }
    return snapshot(state);
  }

  /**
   * Reads an already-provisioned workbench without creating state, locks, or
   * standalone projects. This is reserved for offline maintenance commands.
   */
  async readExistingSnapshotForMaintenance(userId: string): Promise<WorkbenchSnapshot | null> {
    const paths = this.paths(userId);
    await assertSecureDirectory(this.usersRoot, "El directori d’usuaris");
    await assertSecureDirectory(paths.userRoot, "L’usuari");
    try {
      await lstat(paths.stateRoot);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    await assertSecureDirectory(paths.stateRoot, "L’estat de l’usuari");
    const [canonicalUsersRoot, canonicalUserRoot, canonicalStateRoot] = await Promise.all([
      realpath(this.usersRoot),
      realpath(paths.userRoot),
      realpath(paths.stateRoot),
    ]);
    if (
      canonicalUserRoot === canonicalUsersRoot ||
      !inside(canonicalUsersRoot, canonicalUserRoot) ||
      !inside(canonicalUserRoot, canonicalStateRoot)
    ) {
      throw new WorkbenchPersistenceError("La ruta de manteniment del workbench resol fora de l’usuari.");
    }
    await this.assertStateFileSafe(paths.statePath);
    let state: WorkbenchState;
    try {
      state = await readValidatedJson(paths.statePath, workbenchStateSchema);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    if (state.installationId !== this.installationId || state.userId !== userId) {
      throw new WorkbenchPersistenceError("L’estat del workbench no pertany a aquesta instal·lació i usuari.");
    }
    return snapshot(state);
  }

  async listProjects(
    userId: string,
    query: WorkbenchListQuery,
  ): Promise<WorkbenchPage<WorkbenchProject>> {
    assertListQuery(query);
    const state = await this.read(userId);
    const needle = query.query ? normalizeSearchText(query.query) : null;
    const projects = state.projects
      .filter((project) => project.slug !== STANDALONE_PROJECT_SLUG)
      .filter((project) => query.status === "all" || project.status === query.status)
      .filter((project) => !needle ||
        normalizeSearchText(project.name).includes(needle) ||
        normalizeSearchText(project.slug).includes(needle))
      .map(publicProject);
    return paginate(projects, query, `projects:${userId}`);
  }

  async getProject(userId: string, projectId: string): Promise<WorkbenchProject> {
    assertFilesystemWorkbenchId(projectId);
    const project = (await this.read(userId)).projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new WorkbenchNotFoundError("Projecte no trobat.");
    return publicProject(project);
  }

  async listThreads(
    userId: string,
    projectId: string | null,
    query: WorkbenchListQuery,
  ): Promise<WorkbenchPage<WorkbenchThreadSummary>> {
    if (projectId !== null) assertFilesystemWorkbenchId(projectId);
    assertListQuery(query);
    const state = await this.read(userId);
    if (projectId !== null && !state.projects.some((project) => project.id === projectId)) {
      throw new WorkbenchNotFoundError("Projecte no trobat.");
    }
    const needle = query.query ? normalizeSearchText(query.query) : null;
    const threads = state.threads
      .filter((thread) => projectId === null || thread.projectId === projectId)
      .filter((thread) => query.status === "all" || thread.status === query.status)
      .filter((thread) => !needle || normalizeSearchText(thread.title).includes(needle))
      .map(threadSummary);
    return paginate(threads, query, `threads:${userId}:${projectId ?? "all"}`);
  }

  async getThread(userId: string, threadId: string): Promise<WorkbenchThread> {
    assertFilesystemWorkbenchId(threadId);
    const thread = (await this.read(userId)).threads.find((candidate) => candidate.id === threadId);
    if (!thread) throw new WorkbenchNotFoundError("Fil no trobat.");
    return publicThread(thread);
  }

  async createProject(userId: string, name: string): Promise<WorkbenchProject> {
    if (!isProjectName(name)) throw new WorkbenchPersistenceError("El nom del projecte no és vàlid.");
    return this.mutate(userId, (state) => {
      const slug = uniqueSlug(name, new Set(state.projects.map((project) => project.slug)));
      const project = newProject(name, slug);
      state.projects.push(project);
      return publicProject(project);
    });
  }

  async updateProject(
    userId: string,
    projectId: string,
    patch: UpdateProjectInput,
  ): Promise<WorkbenchProject> {
    assertFilesystemWorkbenchId(projectId);
    if (!isUpdateProjectInput(patch)) {
      throw new WorkbenchPersistenceError("L’actualització del projecte no és vàlida.");
    }
    return this.mutate(userId, (state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new WorkbenchNotFoundError("Projecte no trobat.");
      if (project.slug === STANDALONE_PROJECT_SLUG) {
        throw new WorkbenchConflictError("El projecte intern de converses no es pot modificar.");
      }
      if (patch.name !== undefined) {
        project.name = patch.name.trim();
        project.workspace.label = project.name;
      }
      if (patch.pinned !== undefined) project.pinned = patch.pinned;
      if (patch.status !== undefined) project.status = patch.status;
      if (patch.instructions !== undefined) project.instructions = patch.instructions;
      if (patch.sources !== undefined) project.sources = patch.sources;
      if (patch.memory !== undefined) project.memory = patch.memory;
      if (patch.sharing !== undefined) project.sharing = patch.sharing;
      project.updatedAt = new Date().toISOString();
      return publicProject(project);
    });
  }

  async createThread(
    userId: string,
    projectId: string,
    title: string,
  ): Promise<WorkbenchThread> {
    assertFilesystemWorkbenchId(projectId);
    if (!isThreadTitle(title)) throw new WorkbenchPersistenceError("El títol del fil no és vàlid.");
    return this.mutate(userId, (state) => {
      const project = state.projects.find((candidate) => candidate.id === projectId);
      if (!project || project.status !== "active") {
        throw new WorkbenchNotFoundError("Projecte actiu no trobat.");
      }
      const now = new Date().toISOString();
      const thread: StoredThread = {
        id: randomUUID(),
        projectId,
        title: title.trim(),
        status: "active",
        pinned: false,
        createdAt: now,
        updatedAt: now,
        messages: [],
        runtimeThreadToken: null,
      };
      state.threads.push(thread);
      project.updatedAt = now;
      return publicThread(thread);
    });
  }

  async updateThread(
    userId: string,
    threadId: string,
    patch: UpdateThreadInput,
  ): Promise<WorkbenchThread> {
    assertFilesystemWorkbenchId(threadId);
    if (!isUpdateThreadInput(patch)) {
      throw new WorkbenchPersistenceError("L’actualització del fil no és vàlida.");
    }
    return this.mutate(userId, (state) => {
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new WorkbenchNotFoundError("Fil no trobat.");
      if (patch.status === "active") {
        const project = state.projects.find((candidate) => candidate.id === thread.projectId);
        if (!project || project.status !== "active") {
          throw new WorkbenchConflictError("Cal restaurar el projecte abans de restaurar el fil.");
        }
      }
      if (patch.title !== undefined) thread.title = patch.title.trim();
      if (patch.pinned !== undefined) thread.pinned = patch.pinned;
      if (patch.status !== undefined) thread.status = patch.status;
      thread.updatedAt = new Date().toISOString();
      return publicThread(thread);
    });
  }

  private runtimeContext(state: WorkbenchState, projectId: string): ThreadRuntimeContext {
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.status !== "active") {
      throw new WorkbenchNotFoundError("Projecte actiu no trobat.");
    }
    return {
      projectId: project.id,
      projectName: project.name,
      workspaceKey: project.workspaceKey,
      projectInstructions: project.instructions,
      projectMemory: project.memory.enabled ? project.memory.notes : "",
      projectSources: project.sources.map(({ kind, name, url, excerpt, status }) => ({
        kind, name, url, excerpt, status,
      })),
      runtimeThreadToken: null,
      branchHistory: null,
    };
  }

  async getProjectRuntimeContext(userId: string, projectId: string) {
    assertFilesystemWorkbenchId(projectId);
    return this.runtimeContext(await this.read(userId), projectId);
  }

  async getThreadRuntimeContext(userId: string, threadId: string): Promise<ThreadRuntimeContext> {
    assertFilesystemWorkbenchId(threadId);
    const state = await this.read(userId);
    const thread = state.threads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.status !== "active") {
      throw new WorkbenchNotFoundError("Fil actiu no trobat.");
    }
    return {
      ...this.runtimeContext(state, thread.projectId),
      runtimeThreadToken: thread.runtimeThreadToken,
      branchHistory: branchHistory(thread),
    };
  }

  async branchThread(
    userId: string,
    threadId: string,
    input: import("@/workbench/types").BranchThreadInput,
  ): Promise<import("@/workbench/types").BranchThreadResult> {
    assertFilesystemWorkbenchId(threadId);
    if (!isBranchThreadInput(input)) throw new WorkbenchValidationError("La branca no és vàlida.");
    return this.mutate(userId, (state) => {
      const parent = state.threads.find((candidate) => candidate.id === threadId);
      if (!parent || parent.status !== "active") {
        throw new WorkbenchNotFoundError("Fil actiu no trobat.");
      }
      const targetIndex = parent.messages.findIndex((message) => message.id === input.messageId);
      const target = parent.messages[targetIndex];
      if (!target) throw new WorkbenchNotFoundError("Missatge no trobat.");

      let prefixEnd = targetIndex;
      let draftMessage: string | null = null;
      if (input.kind === "edit") {
        if (target.role !== "user" || !input.editedContent?.trim()) {
          throw new WorkbenchValidationError("Només es poden editar missatges de l’usuari.");
        }
        prefixEnd = targetIndex - 1;
        draftMessage = input.editedContent.trim();
      } else if (input.kind === "retry") {
        if (target.role !== "assistant") {
          throw new WorkbenchValidationError("Només es poden regenerar respostes de l’assistent.");
        }
        const userIndex = parent.messages.findLastIndex(
          (message, index) => index < targetIndex && message.role === "user",
        );
        if (userIndex < 0) throw new WorkbenchConflictError("La resposta no té cap petició per regenerar.");
        prefixEnd = userIndex - 1;
        draftMessage = parent.messages[userIndex].content;
      } else if (target.role !== "assistant") {
        throw new WorkbenchValidationError("La branca ha de començar des d’una resposta.");
      }

      const now = new Date().toISOString();
      const suffix = input.kind === "edit" ? "editada" : input.kind === "retry" ? "regenerada" : "rama";
      const title = `${parent.title.replace(/ · (?:editada|regenerada|rama)$/u, "")} · ${suffix}`.slice(0, 120);
      const thread: StoredThread = {
        id: randomUUID(),
        projectId: parent.projectId,
        title,
        status: "active",
        pinned: false,
        createdAt: now,
        updatedAt: now,
        messages: structuredClone(parent.messages.slice(0, prefixEnd + 1)),
        runtimeThreadToken: null,
        lineage: {
          parentThreadId: parent.id,
          branchedFromMessageId: target.id,
          kind: input.kind,
        },
      };
      state.threads.push(thread);
      const project = state.projects.find((candidate) => candidate.id === parent.projectId);
      if (project) project.updatedAt = now;
      return { thread: publicThread(thread), draftMessage };
    });
  }

  async beginThreadTurn(
    userId: string,
    threadId: string,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
  ) {
    assertFilesystemWorkbenchId(threadId);
    return this.mutate(userId, (state) => {
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread || thread.status !== "active") {
        throw new WorkbenchNotFoundError("Fil actiu no trobat.");
      }
      if (!isStrictChatMessage(userMessage) || !isStrictChatMessage(assistantMessage)) {
        throw new WorkbenchPersistenceError("El torn conté missatges no vàlids.");
      }
      if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
        throw new WorkbenchPersistenceError("Els rols del torn no són vàlids.");
      }
      const existingUserIndex = thread.messages.findIndex((message) => message.id === userMessage.id);
      const existingAssistantIndex = thread.messages.findIndex((message) => message.id === assistantMessage.id);
      if (existingUserIndex !== -1 || existingAssistantIndex !== -1) {
        const existingUser = thread.messages[existingUserIndex];
        const existingAssistant = thread.messages[existingAssistantIndex];
        if (
          existingUserIndex >= 0 && existingAssistantIndex === existingUserIndex + 1 &&
          existingUser?.role === "user" && existingAssistant?.role === "assistant" &&
          existingUser.content === userMessage.content &&
          JSON.stringify(existingUser.attachments) === JSON.stringify(userMessage.attachments)
        ) {
          return { outcome: "existing" as const, assistantMessage: existingAssistant };
        }
        throw new WorkbenchConflictError("Els identificadors del torn ja existeixen amb un altre contingut.");
      }
      if (thread.messages.some((message) => message.role === "assistant" && message.status === "streaming")) {
        throw new WorkbenchConflictError("Aquest fil ja té un torn actiu.");
      }
      thread.messages.push(userMessage, assistantMessage);
      thread.updatedAt = new Date().toISOString();
      return { outcome: "created" as const, assistantMessage };
    });
  }

  async finishThreadTurn(
    userId: string,
    threadId: string,
    assistantMessage: ChatMessage,
    runtimeThreadToken: string | null,
  ) {
    assertFilesystemWorkbenchId(threadId);
    await this.mutate(userId, (state) => {
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new WorkbenchNotFoundError("Fil no trobat.");
      if (!isStrictChatMessage(assistantMessage) || assistantMessage.role !== "assistant") {
        throw new WorkbenchPersistenceError("El resultat del torn no és vàlid.");
      }
      if (runtimeThreadToken !== null && (
        runtimeThreadToken.length === 0 ||
        runtimeThreadToken.length > 1_024 ||
        /\p{C}/u.test(runtimeThreadToken)
      )) {
        throw new WorkbenchPersistenceError("El token privat de represa no és vàlid.");
      }
      const messageIndex = thread.messages.findIndex((message) => message.id === assistantMessage.id);
      if (messageIndex === -1) throw new WorkbenchNotFoundError("Missatge del torn no trobat.");
      thread.messages[messageIndex] = assistantMessage;
      if (runtimeThreadToken !== null) thread.runtimeThreadToken = runtimeThreadToken;
      thread.updatedAt = new Date().toISOString();
    });
  }

  async updateMessageActivity(
    userId: string,
    threadId: string,
    messageId: string,
    item: ChatMessage["activity"][number],
  ) {
    assertFilesystemWorkbenchId(threadId);
    assertFilesystemWorkbenchId(messageId);
    return this.mutate(userId, (state) => {
      if (
        !hasExactKeys(item, ["id", "kind", "label", "status"], ["detail", "output", "files"]) ||
        !isActivityItem(item)
      ) {
        throw new WorkbenchPersistenceError("L’activitat no és vàlida.");
      }
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new WorkbenchNotFoundError("Fil no trobat.");
      const message = thread.messages.find((candidate) =>
        candidate.id === messageId && candidate.role === "assistant");
      if (!message) throw new WorkbenchNotFoundError("Resultat no trobat.");
      const itemIndex = message.activity.findIndex((candidate) => candidate.id === item.id);
      if (itemIndex === -1) message.activity.push(item);
      else message.activity[itemIndex] = item;
      thread.updatedAt = new Date().toISOString();
      return message;
    });
  }
}

export function assertFilesystemWorkbenchId(value: string) {
  if (!isUuid(value)) throw new WorkbenchNotFoundError("Identificador no vàlid.");
}
