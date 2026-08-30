import "server-only";

import type { ProjectSource, WorkbenchProject, WorkbenchThread } from "@/workbench/types";

export type StoredProject = WorkbenchProject & {
  workspaceKey: string;
};

export type StoredThread = WorkbenchThread & {
  runtimeThreadToken: string | null;
};

export type ThreadRuntimeContext = {
  projectId: string;
  projectName: string;
  workspaceKey: string;
  projectInstructions: string;
  projectMemory: string;
  projectSources: Pick<ProjectSource, "kind" | "name" | "url" | "excerpt" | "status">[];
  runtimeThreadToken: string | null;
  /** Full persisted history used only to start a branch without replaying the parent's final state. */
  branchHistory: string | null;
};

/**
 * The project catalogue the authenticated user can actually see in the
 * workbench sidebar. This is deliberately separate from runtime workspaces,
 * thread snapshots and other filesystem identifiers.
 */
export type VisibleProjectReference = {
  id: string;
  name: string;
};

export type AgentThreadRuntimeContext = ThreadRuntimeContext & {
  visibleProjects: readonly VisibleProjectReference[];
};

export function conversationHistory(thread: StoredThread) {
  if (thread.messages.length === 0) return null;
  return thread.messages.map((message) => {
    const role = message.role === "user" ? "USER" : "ASSISTANT";
    const attachments = message.attachments.length
      ? `\n[Attachments: ${message.attachments.map((item) => item.name).join(", ")}]`
      : "";
    return `${role}:\n${message.content}${attachments}`;
  }).join("\n\n");
}

export function branchHistory(thread: StoredThread) {
  if (!thread.lineage || thread.runtimeThreadToken) return null;
  return conversationHistory(thread);
}

export function publicProject(project: StoredProject): WorkbenchProject {
  const { workspaceKey: _workspaceKey, ...visible } = project;
  return visible;
}

export function publicThread(thread: StoredThread): WorkbenchThread {
  const { runtimeThreadToken: _runtimeThreadToken, ...visible } = thread;
  return visible;
}

export function slugifyName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);
  return normalized || "projecte";
}

export function uniqueSlug(name: string, used: Set<string>) {
  const base = slugifyName(name);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 58 - String(suffix).length)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No s’ha pogut generar un slug únic per al projecte.");
}
