import type { ChatMessage } from "@/lib/chat-contract";
import { isChatMessage } from "@/lib/chat-contract";

export type ProjectStatus = "active" | "archived";
export type ThreadStatus = "active" | "archived";
export type WorkspaceStatus = "ready" | "pending" | "unavailable";
export type WorkbenchPersistence = "supabase" | "filesystem" | "filesystem-demo" | "browser-preview";

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

export type WorkbenchThreadSummary = Omit<WorkbenchThread, "messages"> & {
  messageCount: number;
  lastMessageAt: string | null;
};

export type WorkbenchPage<Item> = {
  items: Item[];
  nextCursor: string | null;
};

export type WorkbenchStatusFilter = ProjectStatus | "all";
export type WorkbenchListQuery = {
  status: WorkbenchStatusFilter;
  limit: number;
  query?: string;
  cursor?: string;
};

export const WORKBENCH_DEFAULT_PAGE_SIZE = 20;
export const WORKBENCH_MAX_PAGE_SIZE = 50;
export const WORKBENCH_MAX_QUERY_LENGTH = 100;
export const WORKBENCH_MAX_CURSOR_LENGTH = 256;

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
  return typeof value === "string" && value.length <= 80 && value.trim().length > 0;
}

export function isThreadTitle(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && value.trim().length > 0;
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

export function isWorkbenchThreadSummary(value: unknown): value is WorkbenchThreadSummary {
  if (!isRecord(value)) return false;
  const keys = [
    "id", "projectId", "title", "status", "pinned", "createdAt", "updatedAt",
    "messageCount", "lastMessageAt",
  ];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    return false;
  }
  const { messageCount, lastMessageAt, ...thread } = value;
  return isWorkbenchThread({ ...thread, messages: [] }) &&
    Number.isSafeInteger(messageCount) && (messageCount as number) >= 0 &&
    (lastMessageAt === null || isIsoDate(lastMessageAt));
}

export function isWorkbenchPage<Item>(
  value: unknown,
  isItem: (item: unknown) => item is Item,
): value is WorkbenchPage<Item> {
  return isRecord(value) &&
    Object.keys(value).length === 2 &&
    Array.isArray(value.items) && value.items.every(isItem) &&
    (value.nextCursor === null || (
      typeof value.nextCursor === "string" &&
      value.nextCursor.length > 0 &&
      value.nextCursor.length <= WORKBENCH_MAX_CURSOR_LENGTH &&
      /^[A-Za-z0-9_-]+$/.test(value.nextCursor)
    ));
}

export function parseWorkbenchListQuery(searchParams: URLSearchParams): WorkbenchListQuery | null {
  const allowed = new Set(["status", "limit", "q", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) return null;
  }

  const rawStatus = searchParams.get("status");
  const status: WorkbenchStatusFilter = rawStatus === null
    ? "active"
    : rawStatus === "active" || rawStatus === "archived" || rawStatus === "all"
      ? rawStatus
      : "all";
  if (rawStatus !== null && status !== rawStatus) return null;

  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? WORKBENCH_DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > WORKBENCH_MAX_PAGE_SIZE ||
    (rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit))
  ) return null;

  const rawQuery = searchParams.get("q");
  const query = rawQuery?.trim();
  if (rawQuery !== null && (
    rawQuery.length > WORKBENCH_MAX_QUERY_LENGTH || !query || /\p{C}/u.test(query)
  )) return null;

  const cursor = searchParams.get("cursor") ?? undefined;
  if (cursor !== undefined && (
    cursor.length < 1 || cursor.length > WORKBENCH_MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  )) return null;

  return {
    status,
    limit,
    ...(query ? { query } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function isWorkbenchSnapshot(value: unknown): value is WorkbenchSnapshot {
  if (!isRecord(value)) return false;
  return (value.persistence === "supabase" ||
      value.persistence === "filesystem" ||
      value.persistence === "filesystem-demo" ||
      value.persistence === "browser-preview") &&
    Array.isArray(value.projects) && value.projects.every(isWorkbenchProject) &&
    Array.isArray(value.threads) && value.threads.every(isWorkbenchThread);
}

export function isCreateProjectInput(value: unknown): value is CreateProjectInput {
  return isRecord(value) && Object.keys(value).length === 1 && isProjectName(value.name);
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
  return isRecord(value) && Object.keys(value).length === 1 && isThreadTitle(value.title);
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
