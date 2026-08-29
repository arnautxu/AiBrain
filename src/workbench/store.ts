import "server-only";

import { createHash } from "node:crypto";
import type { AuthSession } from "@/auth/types";
import { isVercelPreviewDemoEnabled } from "@/auth/session";
import type { ChatMessage } from "@/lib/chat-contract";
import {
  assertWorkbenchId,
  beginDemoThreadTurn,
  branchDemoThread,
  createDemoProject,
  createDemoThread,
  finishDemoThreadTurn,
  getDemoThread,
  getDemoProjectRuntimeContext,
  getDemoThreadRuntimeContext,
  loadDemoWorkbench,
  updateDemoProject,
  updateDemoThread,
  updateDemoMessageActivity,
} from "@/workbench/demo-store";
import { WorkbenchConflictError, WorkbenchPersistenceError, WorkbenchValidationError } from "@/workbench/errors";
import {
  assertFilesystemWorkbenchId,
  FileWorkbenchStore,
} from "@/workbench/filesystem-store";
import { loadInstallationConfig } from "@/config/installation";
import type {
  BranchThreadInput,
  UpdateProjectInput,
  UpdateThreadInput,
  WorkbenchProject,
  WorkbenchListQuery,
  WorkbenchSnapshot,
} from "@/workbench/types";
import { STANDALONE_PROJECT_SLUG } from "@/workbench/types";
import type { AgentThreadRuntimeContext, ThreadRuntimeContext } from "@/workbench/internal";
import {
  loadSharedWorkbench,
  loadSharedWorkbenchForResolvedThread,
  normalizeProjectMembers,
  resolveProjectAccess,
  resolveThreadAccess,
  syncOwnSharedAccess,
  syncSharedThreadAccess,
  threadSummary,
} from "@/workbench/shared-access";

function mode(session: AuthSession): "filesystem" | "demo" {
  if (session?.provider === "local") return "filesystem";
  if (session?.provider === "demo") return "demo";
  throw new WorkbenchPersistenceError("La sessió no té un adapter de producte autoritzat.");
}

function sharedPageFingerprint(scope: string, query: WorkbenchListQuery) {
  return createHash("sha256").update(JSON.stringify({ scope, status: query.status, query: query.query ?? null }))
    .digest("base64url").slice(0, 16);
}

function sharedPage<Item>(items: Item[], query: WorkbenchListQuery, scope: string) {
  const fingerprint = sharedPageFingerprint(scope, query);
  let offset = 0;
  if (query.cursor) {
    try {
      const raw = Buffer.from(query.cursor, "base64url");
      if (raw.toString("base64url") !== query.cursor || raw.byteLength > 128) throw new Error("cursor");
      const value: unknown = JSON.parse(raw.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).length !== 3 || !("v" in value) || value.v !== 1 ||
          !("offset" in value) || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0 ||
          !("fingerprint" in value) || value.fingerprint !== fingerprint) throw new Error("cursor");
      offset = value.offset as number;
    } catch (error) {
      throw new WorkbenchValidationError("El cursor de paginació no és vàlid.", { cause: error });
    }
  }
  const page = items.slice(offset, offset + query.limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length
      ? Buffer.from(JSON.stringify({ v: 1, offset: nextOffset, fingerprint }), "utf8").toString("base64url")
      : null,
  };
}

function compareVisibleProjects(left: WorkbenchProject, right: WorkbenchProject) {
  return Number(right.pinned) - Number(left.pinned)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id);
}

/** Mirrors the active project section of the UI sidebar, using only the
 * server-authorized workbench snapshot for this session. */
export function visibleProjectReferences(snapshot: Pick<WorkbenchSnapshot, "projects">) {
  return snapshot.projects
    .filter((project) => project.status === "active" && project.slug !== STANDALONE_PROJECT_SLUG)
    .toSorted(compareVisibleProjects)
    .map(({ id, name }) => ({ id, name }));
}

function withVisibleProjects(
  context: ThreadRuntimeContext,
  snapshot: Pick<WorkbenchSnapshot, "projects">,
): AgentThreadRuntimeContext {
  return { ...context, visibleProjects: visibleProjectReferences(snapshot) };
}

async function filesystemStore(session: AuthSession) {
  if (session.provider !== "local") {
    throw new WorkbenchPersistenceError("La sessió no pertany al workbench local.");
  }
  const installation = await loadInstallationConfig();
  if (session.tenant.id !== installation.installationId) {
    throw new WorkbenchPersistenceError("La sessió no pertany a aquesta instal·lació.");
  }
  return FileWorkbenchStore.fromInstallation(installation);
}

export function isBrowserPreviewWorkbench() {
  return isVercelPreviewDemoEnabled();
}

export async function loadWorkbench(session: AuthSession) {
  if (mode(session) === "filesystem") {
    return loadSharedWorkbench(session);
  }
  return loadDemoWorkbench(
    session,
    isBrowserPreviewWorkbench() ? "browser-preview" : "filesystem-demo",
  );
}

export async function listProjects(session: AuthSession, query: WorkbenchListQuery) {
  await filesystemStore(session);
  const snapshot = await loadSharedWorkbench(session);
  const needle = query.query?.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const items = snapshot.projects.filter((project) => project.slug !== "aibrain-standalone-chats")
    .filter((project) => query.status === "all" || project.status === query.status)
    .filter((project) => !needle || `${project.name} ${project.slug}`.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().includes(needle))
    .toSorted((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return sharedPage(items, query, `projects:${session.user.id}`);
}

export async function getProject(session: AuthSession, projectId: string) {
  assertFilesystemWorkbenchId(projectId);
  const access = await resolveProjectAccess(session, projectId);
  return access.store.getProject(access.ownerUserId, projectId);
}

export async function listThreads(
  session: AuthSession,
  projectId: string | null,
  query: WorkbenchListQuery,
) {
  if (projectId !== null) assertFilesystemWorkbenchId(projectId);
  await filesystemStore(session);
  const snapshot = projectId === null
    ? await loadSharedWorkbench(session)
    : await (async () => {
        const access = await resolveProjectAccess(session, projectId);
        return access.store.load(access.ownerUserId);
      })();
  const needle = query.query?.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const items = snapshot.threads.filter((thread) => projectId === null || thread.projectId === projectId)
    .filter((thread) => query.status === "all" || thread.status === query.status)
    .filter((thread) => !needle || thread.title.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().includes(needle))
    .map(threadSummary)
    .toSorted((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return sharedPage(items, query, `threads:${session.user.id}:${projectId ?? "all"}`);
}

export async function getThread(session: AuthSession, threadId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    return access.store.getThread(access.ownerUserId, threadId);
  }
  assertWorkbenchId(threadId);
  return getDemoThread(session, threadId);
}

export async function createProject(session: AuthSession, name: string) {
  if (mode(session) === "filesystem") {
    const project = await (await filesystemStore(session)).createProject(session.user.id, name);
    await syncOwnSharedAccess(session);
    return project;
  }
  return createDemoProject(session, name);
}

export async function updateProject(
  session: AuthSession,
  projectId: string,
  patch: UpdateProjectInput,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    const access = await resolveProjectAccess(session, projectId);
    if (access.role === "viewer" || (access.role !== "owner" && (patch.sharing !== undefined || patch.status !== undefined))) {
      throw new WorkbenchConflictError("No tens permís per gestionar aquest projecte compartit.");
    }
    const normalized = patch.sharing
      ? { ...patch, sharing: await normalizeProjectMembers(session, { ...access.project, sharing: patch.sharing }) }
      : patch;
    const project = await access.store.updateProject(access.ownerUserId, projectId, normalized);
    if (access.ownerUserId === session.user.id) await syncOwnSharedAccess(session);
    return project;
  }
  assertWorkbenchId(projectId);
  return updateDemoProject(session, projectId, patch);
}

export async function createThread(
  session: AuthSession,
  projectId: string,
  title: string,
  options: { id?: string } = {},
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    const access = await resolveProjectAccess(session, projectId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    const thread = await access.store.createThread(access.ownerUserId, projectId, title, options.id);
    await syncSharedThreadAccess(session, access.ownerUserId, projectId, thread.id);
    return thread;
  }
  if (options.id) throw new WorkbenchPersistenceError("Los ids deterministas requieren el workbench local persistente.");
  assertWorkbenchId(projectId);
  return createDemoThread(session, projectId, title);
}

export async function updateThread(
  session: AuthSession,
  threadId: string,
  patch: UpdateThreadInput,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    return access.store.updateThread(access.ownerUserId, threadId, patch);
  }
  assertWorkbenchId(threadId);
  return updateDemoThread(session, threadId, patch);
}

export async function branchThread(
  session: AuthSession,
  threadId: string,
  input: BranchThreadInput,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    const result = await access.store.branchThread(access.ownerUserId, threadId, input);
    await syncSharedThreadAccess(session, access.ownerUserId, access.project.id, result.thread.id);
    return result;
  }
  assertWorkbenchId(threadId);
  return branchDemoThread(session, threadId, input);
}

export async function getProjectRuntimeContext(session: AuthSession, projectId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    const access = await resolveProjectAccess(session, projectId);
    return access.store.getProjectRuntimeContext(access.ownerUserId, projectId);
  }
  assertWorkbenchId(projectId);
  return getDemoProjectRuntimeContext(session, projectId);
}

export async function getThreadRuntimeContext(
  session: AuthSession,
  threadId: string,
): Promise<AgentThreadRuntimeContext> {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    return withVisibleProjects(
      await access.store.getThreadRuntimeContext(access.ownerUserId, threadId),
      await loadSharedWorkbench(session),
    );
  }
  assertWorkbenchId(threadId);
  return withVisibleProjects(
    await getDemoThreadRuntimeContext(session, threadId),
    await loadDemoWorkbench(
      session,
      isBrowserPreviewWorkbench() ? "browser-preview" : "filesystem-demo",
    ),
  );
}

/**
 * Resolves filesystem authorization once for the pre-stream portion of a chat
 * turn. The returned closure can persist the idempotent turn without scanning
 * users and rebuilding the same access context a second time.
 */
export async function prepareThreadTurn(session: AuthSession, threadId: string) {
  if (mode(session) !== "filesystem") {
    throw new WorkbenchPersistenceError("La preparació persistent requereix un workbench local.");
  }
  assertFilesystemWorkbenchId(threadId);
  const access = await resolveThreadAccess(session, threadId);
  if (access.role === "viewer") {
    throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
  }
  const [runtimeContext, visibleSnapshot] = await Promise.all([
    access.store.getThreadRuntimeContext(access.ownerUserId, threadId),
    loadSharedWorkbenchForResolvedThread(access),
  ]);
  return {
    context: withVisibleProjects(runtimeContext, visibleSnapshot),
    begin(userMessage: ChatMessage, assistantMessage: ChatMessage) {
      return access.store.beginThreadTurn(
        access.ownerUserId,
        threadId,
        userMessage,
        assistantMessage,
      );
    },
  };
}

export async function beginThreadTurn(
  session: AuthSession,
  threadId: string,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    return access.store.beginThreadTurn(
      access.ownerUserId,
      threadId,
      userMessage,
      assistantMessage,
    );
  }
  assertWorkbenchId(threadId);
  return beginDemoThreadTurn(session, threadId, userMessage, assistantMessage);
}

export async function finishThreadTurn(
  session: AuthSession,
  threadId: string,
  assistantMessage: ChatMessage,
  runtimeThreadToken: string | null,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    return access.store.finishThreadTurn(
      access.ownerUserId,
      threadId,
      assistantMessage,
      runtimeThreadToken,
    );
  }
  assertWorkbenchId(threadId);
  return finishDemoThreadTurn(
    session,
    threadId,
    assistantMessage,
    runtimeThreadToken,
  );
}

export async function updateMessageActivity(
  session: AuthSession,
  threadId: string,
  messageId: string,
  item: ChatMessage["activity"][number],
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    assertFilesystemWorkbenchId(messageId);
    const access = await resolveThreadAccess(session, threadId);
    if (access.role === "viewer") throw new WorkbenchConflictError("Aquest projecte compartit és de només lectura.");
    return access.store.updateMessageActivity(
      access.ownerUserId,
      threadId,
      messageId,
      item,
    );
  }
  assertWorkbenchId(threadId);
  assertWorkbenchId(messageId);
  return updateDemoMessageActivity(session, threadId, messageId, item);
}
