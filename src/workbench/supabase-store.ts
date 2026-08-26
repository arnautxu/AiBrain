import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "@/auth/types";
import type { ChatMessage } from "@/lib/chat-contract";
import { isChatMessage } from "@/lib/chat-contract";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  publicProject,
  publicThread,
  uniqueSlug,
  type StoredProject,
  type StoredThread,
  type ThreadRuntimeContext,
} from "@/workbench/internal";
import {
  isUuid,
  isWorkbenchProject,
  isWorkbenchThread,
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchThread,
} from "@/workbench/types";
import {
  WorkbenchConflictError,
  WorkbenchNotFoundError,
  WorkbenchPersistenceError,
} from "@/workbench/errors";

const PROJECT_COLUMNS = "id, name, slug, status, is_pinned, created_at, updated_at";
const WORKSPACE_COLUMNS = "id, project_id, workspace_key, label, host_type, status, is_primary";
const THREAD_COLUMNS = "id, project_id, title, status, is_pinned, created_at, updated_at";
const MESSAGE_COLUMNS = "id, thread_id, role, content, status, activity, plan, approvals, attachments, artifacts, diff, created_at, updated_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function databaseError(message: string, error: { code?: string } | null) {
  console.error(message, { code: error?.code });
  return new WorkbenchPersistenceError(message);
}

async function resolveTenantId(client: SupabaseClient, tenantSlug: string) {
  const { data, error } = await client
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut resoldre el tenant del workbench.", error);
  if (!isRecord(data) || typeof data.id !== "number") {
    throw new WorkbenchNotFoundError("Tenant no trobat.");
  }
  return data.id;
}

function parseProject(row: unknown, workspaceRow: unknown): StoredProject {
  if (!isRecord(row) || !isRecord(workspaceRow)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un projecte incomplet.");
  }
  const project: unknown = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    pinned: row.is_pinned,
    workspace: {
      id: workspaceRow.id,
      label: workspaceRow.label,
      hostType: workspaceRow.host_type,
      status: workspaceRow.status,
      isPrimary: workspaceRow.is_primary,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!isWorkbenchProject(project) ||
    typeof workspaceRow.workspace_key !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(workspaceRow.workspace_key)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un projecte no vàlid.");
  }
  return { ...project, workspaceKey: workspaceRow.workspace_key };
}

function parseMessage(row: unknown): ChatMessage {
  if (!isRecord(row)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un missatge incomplet.");
  }
  const message: unknown = {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    activity: row.activity,
    plan: row.plan,
    approvals: row.approvals,
    attachments: row.attachments,
    artifacts: row.artifacts,
    diff: row.diff,
    createdAt: row.created_at,
  };
  if (!isChatMessage(message)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un missatge no vàlid.");
  }
  return message;
}

function parseThread(row: unknown, messages: ChatMessage[]): StoredThread {
  if (!isRecord(row)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un fil incomplet.");
  }
  const thread: unknown = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    pinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
  if (!isWorkbenchThread(thread)) {
    throw new WorkbenchPersistenceError("Postgres ha retornat un fil no vàlid.");
  }
  return { ...thread, runtimeThreadToken: null };
}

async function loadProjectRows(client: SupabaseClient, tenantId: number) {
  const [{ data: projects, error: projectError }, { data: workspaces, error: workspaceError }] =
    await Promise.all([
      client
        .from("projects")
        .select(PROJECT_COLUMNS)
        .eq("tenant_id", tenantId)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(100),
      client
        .from("project_workspaces")
        .select(WORKSPACE_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("is_primary", true)
        .limit(100),
    ]);
  if (projectError) throw databaseError("No s’han pogut carregar els projectes.", projectError);
  if (workspaceError) throw databaseError("No s’han pogut carregar els workspaces.", workspaceError);
  const workspaceByProject = new Map<string, unknown>();
  for (const workspace of workspaces ?? []) {
    if (isRecord(workspace) && typeof workspace.project_id === "string") {
      workspaceByProject.set(workspace.project_id, workspace);
    }
  }
  return (projects ?? []).map((project) => {
    if (!isRecord(project) || typeof project.id !== "string") {
      throw new WorkbenchPersistenceError("Postgres ha retornat un projecte incomplet.");
    }
    return parseProject(project, workspaceByProject.get(project.id));
  });
}

async function loadThreadRows(
  client: SupabaseClient,
  tenantId: number,
  projectIds: string[],
) {
  if (projectIds.length === 0) return [];
  const { data: threadRows, error: threadError } = await client
    .from("threads")
    .select(THREAD_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("project_id", projectIds)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(500);
  if (threadError) throw databaseError("No s’han pogut carregar els fils.", threadError);
  const threadIds = (threadRows ?? []).flatMap((row) =>
    isRecord(row) && typeof row.id === "string" ? [row.id] : [],
  );
  const messagesByThread = new Map<string, ChatMessage[]>();
  if (threadIds.length > 0) {
    const { data: messageRows, error: messageError } = await client
      .from("thread_messages")
      .select(MESSAGE_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(5000);
    if (messageError) throw databaseError("No s’han pogut carregar els missatges.", messageError);
    for (const row of messageRows ?? []) {
      if (!isRecord(row) || typeof row.thread_id !== "string") {
        throw new WorkbenchPersistenceError("Postgres ha retornat un missatge sense fil.");
      }
      const messages = messagesByThread.get(row.thread_id) ?? [];
      messages.push(parseMessage(row));
      messagesByThread.set(row.thread_id, messages);
    }
  }
  return (threadRows ?? []).map((row) => {
    if (!isRecord(row) || typeof row.id !== "string") {
      throw new WorkbenchPersistenceError("Postgres ha retornat un fil incomplet.");
    }
    return parseThread(row, messagesByThread.get(row.id) ?? []);
  });
}

export async function loadSupabaseWorkbench(session: AuthSession): Promise<WorkbenchSnapshot> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const projects = await loadProjectRows(client, tenantId);
  const threads = await loadThreadRows(client, tenantId, projects.map((project) => project.id));
  return {
    persistence: "supabase",
    projects: projects.map(publicProject),
    threads: threads.map(publicThread),
  };
}

async function loadSupabaseProject(
  client: SupabaseClient,
  tenantId: number,
  projectId: string,
) {
  const [{ data: project, error: projectError }, { data: workspace, error: workspaceError }] =
    await Promise.all([
      client.from("projects").select(PROJECT_COLUMNS).eq("tenant_id", tenantId).eq("id", projectId).maybeSingle(),
      client.from("project_workspaces").select(WORKSPACE_COLUMNS).eq("tenant_id", tenantId).eq("project_id", projectId).eq("is_primary", true).maybeSingle(),
    ]);
  if (projectError) throw databaseError("No s’ha pogut carregar el projecte.", projectError);
  if (workspaceError) throw databaseError("No s’ha pogut carregar el workspace.", workspaceError);
  if (!project || !workspace) throw new WorkbenchNotFoundError("Projecte no trobat.");
  return parseProject(project, workspace);
}

export async function createSupabaseProject(
  session: AuthSession,
  name: string,
): Promise<WorkbenchProject> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const { data: existing, error: slugError } = await client
    .from("projects")
    .select("slug")
    .eq("tenant_id", tenantId)
    .limit(1000);
  if (slugError) throw databaseError("No s’han pogut validar els slugs del tenant.", slugError);
  const used = new Set((existing ?? []).flatMap((row) =>
    isRecord(row) && typeof row.slug === "string" ? [row.slug] : [],
  ));
  const slug = uniqueSlug(name, used);
  const { data: projectId, error } = await client.rpc("create_project", {
    p_tenant_slug: session.tenant.id,
    p_name: name.trim(),
    p_slug: slug,
    p_workspace_key: `project-${randomUUID()}`,
  });
  if (error) {
    if (error.code === "23505") throw new WorkbenchConflictError("Ja existeix un projecte amb aquest nom.");
    throw databaseError("No s’ha pogut crear el projecte.", error);
  }
  if (!isUuid(projectId)) throw new WorkbenchPersistenceError("Postgres no ha retornat un projecte vàlid.");
  return publicProject(await loadSupabaseProject(client, tenantId, projectId));
}

export async function updateSupabaseProject(
  session: AuthSession,
  projectId: string,
  patch: UpdateProjectInput,
): Promise<WorkbenchProject> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const update = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.pinned !== undefined ? { is_pinned: patch.pinned } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  };
  const { data, error } = await client
    .from("projects")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut actualitzar el projecte.", error);
  if (!data) throw new WorkbenchNotFoundError("Projecte no trobat.");
  return publicProject(await loadSupabaseProject(client, tenantId, projectId));
}

export async function createSupabaseThread(
  session: AuthSession,
  projectId: string,
  title: string,
): Promise<WorkbenchThread> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const project = await loadSupabaseProject(client, tenantId, projectId);
  if (project.status !== "active") throw new WorkbenchNotFoundError("Projecte actiu no trobat.");
  const { data, error } = await client
    .from("threads")
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      created_by: session.user.id,
      title: title.trim(),
      status: "active",
      is_pinned: false,
    })
    .select(THREAD_COLUMNS)
    .single();
  if (error) throw databaseError("No s’ha pogut crear el fil.", error);
  return publicThread(parseThread(data, []));
}

async function loadSupabaseThread(
  client: SupabaseClient,
  tenantId: number,
  threadId: string,
) {
  const { data, error } = await client
    .from("threads")
    .select(THREAD_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut carregar el fil.", error);
  if (!data) throw new WorkbenchNotFoundError("Fil no trobat.");
  const { data: rows, error: messageError } = await client
    .from("thread_messages")
    .select(MESSAGE_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (messageError) throw databaseError("No s’han pogut carregar els missatges.", messageError);
  return parseThread(data, (rows ?? []).map(parseMessage));
}

export async function updateSupabaseThread(
  session: AuthSession,
  threadId: string,
  patch: UpdateThreadInput,
): Promise<WorkbenchThread> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const update = {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.pinned !== undefined ? { is_pinned: patch.pinned } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  };
  const { data, error } = await client
    .from("threads")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", threadId)
    .select("id")
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut actualitzar el fil.", error);
  if (!data) throw new WorkbenchNotFoundError("Fil no trobat.");
  return publicThread(await loadSupabaseThread(client, tenantId, threadId));
}

async function projectRuntimeContext(
  client: SupabaseClient,
  tenantId: number,
  projectId: string,
): Promise<ThreadRuntimeContext> {
  const project = await loadSupabaseProject(client, tenantId, projectId);
  if (project.status !== "active") throw new WorkbenchNotFoundError("Projecte actiu no trobat.");
  return {
    projectId: project.id,
    projectName: project.name,
    workspaceKey: project.workspaceKey,
    runtimeThreadToken: null,
  };
}

export async function getSupabaseProjectRuntimeContext(session: AuthSession, projectId: string) {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  return projectRuntimeContext(client, tenantId, projectId);
}

export async function getSupabaseThreadRuntimeContext(
  session: AuthSession,
  threadId: string,
): Promise<ThreadRuntimeContext> {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const { data, error } = await client
    .from("threads")
    .select("id, project_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut resoldre el fil.", error);
  if (!isRecord(data) || data.status !== "active" || typeof data.project_id !== "string") {
    throw new WorkbenchNotFoundError("Fil actiu no trobat.");
  }
  const context = await projectRuntimeContext(client, tenantId, data.project_id);
  if (!isSupabaseAdminConfigured()) return context;
  const admin = createSupabaseAdminClient();
  const { data: runtime, error: runtimeError } = await admin
    .from("threads")
    .select("runtime_thread_token")
    .eq("tenant_id", tenantId)
    .eq("id", threadId)
    .maybeSingle();
  if (runtimeError) throw databaseError("No s’ha pogut carregar la represa de Codex.", runtimeError);
  const runtimeThreadToken = isRecord(runtime) && typeof runtime.runtime_thread_token === "string"
    ? runtime.runtime_thread_token
    : null;
  return { ...context, runtimeThreadToken };
}

function messageInsert(
  tenantId: number,
  projectId: string,
  threadId: string,
  message: ChatMessage,
) {
  return {
    id: message.id,
    tenant_id: tenantId,
    project_id: projectId,
    thread_id: threadId,
    role: message.role,
    content: message.content,
    status: message.status,
    activity: message.activity,
    plan: message.plan,
    approvals: message.approvals,
    attachments: message.attachments,
    artifacts: message.artifacts,
    diff: message.diff,
    created_at: message.createdAt,
  };
}

export async function beginSupabaseThreadTurn(
  session: AuthSession,
  threadId: string,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
) {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const context = await getSupabaseThreadRuntimeContext(session, threadId);
  const { error } = await client.from("thread_messages").insert([
    messageInsert(tenantId, context.projectId, threadId, userMessage),
    messageInsert(tenantId, context.projectId, threadId, assistantMessage),
  ]);
  if (error) {
    if (error.code === "23505") throw new WorkbenchConflictError("Aquest torn ja existeix.");
    throw databaseError("No s’ha pogut iniciar el torn persistent.", error);
  }
  const { error: touchError } = await client
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", threadId);
  if (touchError) throw databaseError("No s’ha pogut actualitzar el fil.", touchError);
}

export async function finishSupabaseThreadTurn(
  session: AuthSession,
  threadId: string,
  assistantMessage: ChatMessage,
  runtimeThreadToken: string | null,
) {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const { data, error } = await client
    .from("thread_messages")
    .update({
      content: assistantMessage.content,
      status: assistantMessage.status,
      activity: assistantMessage.activity,
      plan: assistantMessage.plan,
      approvals: assistantMessage.approvals,
      artifacts: assistantMessage.artifacts,
      diff: assistantMessage.diff,
    })
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .eq("id", assistantMessage.id)
    .select("id")
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut completar el missatge persistent.", error);
  if (!data) throw new WorkbenchNotFoundError("Missatge del torn no trobat.");

  const { error: touchError } = await client
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", threadId);
  if (touchError) throw databaseError("No s’ha pogut actualitzar el fil.", touchError);

  if (runtimeThreadToken) {
    if (!isSupabaseAdminConfigured()) {
      throw new WorkbenchPersistenceError(
        "SUPABASE_SECRET_KEY és obligatori per persistir la represa privada de Codex.",
      );
    }
    const admin = createSupabaseAdminClient();
    const { error: runtimeError } = await admin
      .from("threads")
      .update({ runtime_thread_token: runtimeThreadToken })
      .eq("tenant_id", tenantId)
      .eq("id", threadId);
    if (runtimeError) throw databaseError("No s’ha pogut persistir la represa de Codex.", runtimeError);
  }
}

export async function updateSupabaseMessageActivity(
  session: AuthSession,
  threadId: string,
  messageId: string,
  item: ChatMessage["activity"][number],
) {
  const client = await createSupabaseServerClient();
  const tenantId = await resolveTenantId(client, session.tenant.id);
  const { data: row, error: readError } = await client
    .from("thread_messages")
    .select(MESSAGE_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .eq("id", messageId)
    .eq("role", "assistant")
    .maybeSingle();
  if (readError) throw databaseError("No s’ha pogut carregar el resultat.", readError);
  if (!row) throw new WorkbenchNotFoundError("Resultat no trobat.");
  const message = parseMessage(row);
  const index = message.activity.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) message.activity.push(item);
  else message.activity[index] = item;
  const { data, error } = await client
    .from("thread_messages")
    .update({ activity: message.activity })
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .eq("id", messageId)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();
  if (error) throw databaseError("No s’ha pogut desar l’estat del resultat.", error);
  if (!data) throw new WorkbenchNotFoundError("Resultat no trobat.");
  return parseMessage(data);
}
