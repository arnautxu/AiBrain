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

function mode(session?: AuthSession) {
  // Supabase is only the identity verifier. Authenticated local sessions always
  // use the installation's filesystem-backed workbench and never call it again.
  if (session?.provider === "local") return "demo";
  const authMode = getAuthMode();
  if (authMode === "unavailable") {
    throw new WorkbenchPersistenceError("La persistència del workbench no està disponible.");
  }
  return authMode;
}

export function isBrowserPreviewWorkbench() {
  return mode() === "demo" && isVercelPreviewDemoEnabled();
}

export async function loadWorkbench(session: AuthSession) {
  if (mode(session) === "supabase") return loadSupabaseWorkbench(session);
  return loadDemoWorkbench(
    session,
    isBrowserPreviewWorkbench() ? "browser-preview" : "filesystem-demo",
  );
}

export async function createProject(session: AuthSession, name: string) {
  if (mode(session) === "supabase") return createSupabaseProject(session, name);
  return createDemoProject(session, name);
}

export async function updateProject(
  session: AuthSession,
  projectId: string,
  patch: UpdateProjectInput,
) {
  assertWorkbenchId(projectId);
  if (mode(session) === "supabase") return updateSupabaseProject(session, projectId, patch);
  return updateDemoProject(session, projectId, patch);
}

export async function createThread(
  session: AuthSession,
  projectId: string,
  title: string,
) {
  assertWorkbenchId(projectId);
  if (mode(session) === "supabase") return createSupabaseThread(session, projectId, title);
  return createDemoThread(session, projectId, title);
}

export async function updateThread(
  session: AuthSession,
  threadId: string,
  patch: UpdateThreadInput,
) {
  assertWorkbenchId(threadId);
  if (mode(session) === "supabase") return updateSupabaseThread(session, threadId, patch);
  return updateDemoThread(session, threadId, patch);
}

export async function getProjectRuntimeContext(session: AuthSession, projectId: string) {
  assertWorkbenchId(projectId);
  if (mode(session) === "supabase") return getSupabaseProjectRuntimeContext(session, projectId);
  return getDemoProjectRuntimeContext(session, projectId);
}

export async function getThreadRuntimeContext(session: AuthSession, threadId: string) {
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
  assertWorkbenchId(threadId);
  assertWorkbenchId(messageId);
  if (mode(session) === "supabase") {
    return updateSupabaseMessageActivity(session, threadId, messageId, item);
  }
  return updateDemoMessageActivity(session, threadId, messageId, item);
}
