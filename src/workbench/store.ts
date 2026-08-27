import "server-only";

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
import { WorkbenchPersistenceError } from "@/workbench/errors";
import {
  assertFilesystemWorkbenchId,
  FileWorkbenchStore,
} from "@/workbench/filesystem-store";
import { loadInstallationConfig } from "@/config/installation";
import type {
  BranchThreadInput,
  UpdateProjectInput,
  UpdateThreadInput,
  WorkbenchListQuery,
} from "@/workbench/types";

function mode(session: AuthSession): "filesystem" | "demo" {
  if (session?.provider === "local") return "filesystem";
  if (session?.provider === "demo") return "demo";
  throw new WorkbenchPersistenceError("La sessió no té un adapter de producte autoritzat.");
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
    return (await filesystemStore(session)).load(session.user.id);
  }
  return loadDemoWorkbench(
    session,
    isBrowserPreviewWorkbench() ? "browser-preview" : "filesystem-demo",
  );
}

export async function listProjects(session: AuthSession, query: WorkbenchListQuery) {
  return (await filesystemStore(session)).listProjects(session.user.id, query);
}

export async function getProject(session: AuthSession, projectId: string) {
  assertFilesystemWorkbenchId(projectId);
  return (await filesystemStore(session)).getProject(session.user.id, projectId);
}

export async function listThreads(
  session: AuthSession,
  projectId: string | null,
  query: WorkbenchListQuery,
) {
  if (projectId !== null) assertFilesystemWorkbenchId(projectId);
  return (await filesystemStore(session)).listThreads(session.user.id, projectId, query);
}

export async function getThread(session: AuthSession, threadId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    return (await filesystemStore(session)).getThread(session.user.id, threadId);
  }
  assertWorkbenchId(threadId);
  return getDemoThread(session, threadId);
}

export async function createProject(session: AuthSession, name: string) {
  if (mode(session) === "filesystem") {
    return (await filesystemStore(session)).createProject(session.user.id, name);
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
    return (await filesystemStore(session)).updateProject(session.user.id, projectId, patch);
  }
  assertWorkbenchId(projectId);
  return updateDemoProject(session, projectId, patch);
}

export async function createThread(
  session: AuthSession,
  projectId: string,
  title: string,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    return (await filesystemStore(session)).createThread(session.user.id, projectId, title);
  }
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
    return (await filesystemStore(session)).updateThread(session.user.id, threadId, patch);
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
    return (await filesystemStore(session)).branchThread(session.user.id, threadId, input);
  }
  assertWorkbenchId(threadId);
  return branchDemoThread(session, threadId, input);
}

export async function getProjectRuntimeContext(session: AuthSession, projectId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    return (await filesystemStore(session)).getProjectRuntimeContext(session.user.id, projectId);
  }
  assertWorkbenchId(projectId);
  return getDemoProjectRuntimeContext(session, projectId);
}

export async function getThreadRuntimeContext(session: AuthSession, threadId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    return (await filesystemStore(session)).getThreadRuntimeContext(session.user.id, threadId);
  }
  assertWorkbenchId(threadId);
  return getDemoThreadRuntimeContext(session, threadId);
}

export async function beginThreadTurn(
  session: AuthSession,
  threadId: string,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    return (await filesystemStore(session)).beginThreadTurn(
      session.user.id,
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
    return (await filesystemStore(session)).finishThreadTurn(
      session.user.id,
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
    return (await filesystemStore(session)).updateMessageActivity(
      session.user.id,
      threadId,
      messageId,
      item,
    );
  }
  assertWorkbenchId(threadId);
  assertWorkbenchId(messageId);
  return updateDemoMessageActivity(session, threadId, messageId, item);
}
