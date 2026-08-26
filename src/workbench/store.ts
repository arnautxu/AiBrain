import "server-only";

import type { AuthSession } from "@/auth/types";
import { getAuthMode, isVercelPreviewDemoEnabled } from "@/auth/session";
import type { ChatMessage } from "@/lib/chat-contract";
import {
  assertWorkbenchId,
  beginDemoThreadTurn,
  createDemoProject,
  createDemoThread,
  finishDemoThreadTurn,
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
import {
  beginSupabaseThreadTurn,
  createSupabaseProject,
  createSupabaseThread,
  finishSupabaseThreadTurn,
  getSupabaseProjectRuntimeContext,
  getSupabaseThreadRuntimeContext,
  loadSupabaseWorkbench,
  updateSupabaseProject,
  updateSupabaseThread,
  updateSupabaseMessageActivity,
} from "@/workbench/supabase-store";
import type {
  UpdateProjectInput,
  UpdateThreadInput,
} from "@/workbench/types";

function mode(session?: AuthSession): "filesystem" | "demo" | "supabase" {
  // Supabase is only the identity verifier. Authenticated local sessions always
  // use the installation's filesystem-backed workbench and never call it again.
  if (session?.provider === "local") return "filesystem";
  const authMode = getAuthMode();
  if (authMode === "unavailable") {
    throw new WorkbenchPersistenceError("La persistència del workbench no està disponible.");
  }
  return authMode;
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
  return mode() === "demo" && isVercelPreviewDemoEnabled();
}

export async function loadWorkbench(session: AuthSession) {
  if (mode(session) === "filesystem") {
    return (await filesystemStore(session)).load(session.user.id);
  }
  if (mode(session) === "supabase") return loadSupabaseWorkbench(session);
  return loadDemoWorkbench(
    session,
    isBrowserPreviewWorkbench() ? "browser-preview" : "filesystem-demo",
  );
}

export async function createProject(session: AuthSession, name: string) {
  if (mode(session) === "filesystem") {
    return (await filesystemStore(session)).createProject(session.user.id, name);
  }
  if (mode(session) === "supabase") return createSupabaseProject(session, name);
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
  if (mode(session) === "supabase") return updateSupabaseProject(session, projectId, patch);
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
  if (mode(session) === "supabase") return createSupabaseThread(session, projectId, title);
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
  if (mode(session) === "supabase") return updateSupabaseThread(session, threadId, patch);
  return updateDemoThread(session, threadId, patch);
}

export async function getProjectRuntimeContext(session: AuthSession, projectId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(projectId);
    return (await filesystemStore(session)).getProjectRuntimeContext(session.user.id, projectId);
  }
  assertWorkbenchId(projectId);
  if (mode(session) === "supabase") return getSupabaseProjectRuntimeContext(session, projectId);
  return getDemoProjectRuntimeContext(session, projectId);
}

export async function getThreadRuntimeContext(session: AuthSession, threadId: string) {
  if (mode(session) === "filesystem") {
    assertFilesystemWorkbenchId(threadId);
    return (await filesystemStore(session)).getThreadRuntimeContext(session.user.id, threadId);
  }
  assertWorkbenchId(threadId);
  if (mode(session) === "supabase") return getSupabaseThreadRuntimeContext(session, threadId);
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
  if (mode(session) === "supabase") {
    return beginSupabaseThreadTurn(session, threadId, userMessage, assistantMessage);
  }
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
  if (mode(session) === "supabase") {
    return finishSupabaseThreadTurn(
      session,
      threadId,
      assistantMessage,
      runtimeThreadToken,
    );
  }
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
  if (mode(session) === "supabase") {
    return updateSupabaseMessageActivity(session, threadId, messageId, item);
  }
  return updateDemoMessageActivity(session, threadId, messageId, item);
}
