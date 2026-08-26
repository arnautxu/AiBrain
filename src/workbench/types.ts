import type { ChatMessage } from "@/lib/chat-contract";
import { isChatMessage } from "@/lib/chat-contract";

export type ProjectStatus = "active" | "archived";
export type ThreadStatus = "active" | "archived";
export type WorkspaceStatus = "ready" | "pending" | "unavailable";
export type WorkbenchPersistence = "supabase" | "filesystem-demo" | "browser-preview";

export type WorkbenchWorkspace = {
  id: string;
  label: string;
  hostType: "managed";
  status: WorkspaceStatus;
  isPrimary: boolean;
};

export type WorkbenchProject = {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  pinned: boolean;
  workspace: WorkbenchWorkspace;
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchThread = {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type WorkbenchSnapshot = {
  persistence: WorkbenchPersistence;
  projects: WorkbenchProject[];
  threads: WorkbenchThread[];
};

export type CreateProjectInput = { name: string };
export type UpdateProjectInput = {
  name?: string;
  pinned?: boolean;
  status?: ProjectStatus;
};
export type CreateThreadInput = { title: string };
export type UpdateThreadInput = {
  title?: string;
  pinned?: boolean;
  status?: ThreadStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isProjectName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
}

export function isThreadTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;
}

export function isWorkbenchWorkspace(value: unknown): value is WorkbenchWorkspace {
  if (!isRecord(value)) return false;
  return isUuid(value.id) &&
    typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 100 &&
    value.hostType === "managed" &&
    (value.status === "ready" || value.status === "pending" || value.status === "unavailable") &&
    typeof value.isPrimary === "boolean";
}

export function isWorkbenchProject(value: unknown): value is WorkbenchProject {
  if (!isRecord(value)) return false;
  return isUuid(value.id) &&
    isProjectName(value.name) &&
    typeof value.slug === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.slug) &&
    (value.status === "active" || value.status === "archived") &&
    typeof value.pinned === "boolean" &&
    isWorkbenchWorkspace(value.workspace) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt);
}

export function isWorkbenchThread(value: unknown): value is WorkbenchThread {
  if (!isRecord(value)) return false;
  return isUuid(value.id) &&
    isUuid(value.projectId) &&
    isThreadTitle(value.title) &&
    (value.status === "active" || value.status === "archived") &&
    typeof value.pinned === "boolean" &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt) &&
    Array.isArray(value.messages) &&
    value.messages.every(isChatMessage);
}

export function isWorkbenchSnapshot(value: unknown): value is WorkbenchSnapshot {
  if (!isRecord(value)) return false;
  return (value.persistence === "supabase" ||
      value.persistence === "filesystem-demo" ||
      value.persistence === "browser-preview") &&
    Array.isArray(value.projects) && value.projects.every(isWorkbenchProject) &&
    Array.isArray(value.threads) && value.threads.every(isWorkbenchThread);
}

export function isCreateProjectInput(value: unknown): value is CreateProjectInput {
  return isRecord(value) && isProjectName(value.name);
}

export function isUpdateProjectInput(value: unknown): value is UpdateProjectInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !["name", "pinned", "status"].includes(key))) {
    return false;
  }
  return (!("name" in value) || isProjectName(value.name)) &&
    (!("pinned" in value) || typeof value.pinned === "boolean") &&
    (!("status" in value) || value.status === "active" || value.status === "archived");
}

export function isCreateThreadInput(value: unknown): value is CreateThreadInput {
  return isRecord(value) && isThreadTitle(value.title);
}

export function isUpdateThreadInput(value: unknown): value is UpdateThreadInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !["title", "pinned", "status"].includes(key))) {
    return false;
  }
  return (!("title" in value) || isThreadTitle(value.title)) &&
    (!("pinned" in value) || typeof value.pinned === "boolean") &&
    (!("status" in value) || value.status === "active" || value.status === "archived");
}
