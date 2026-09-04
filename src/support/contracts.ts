export const SUPPORT_KINDS = ["bug", "request", "help"] as const;
export type SupportKind = typeof SUPPORT_KINDS[number];

export type SafeSupportContext = {
  pathname: string;
  projectId: string | null;
  threadId: string | null;
  viewport: "mobile" | "desktop";
};

export type SupportRequestInput = {
  kind: SupportKind;
  description: string;
  context: SafeSupportContext;
};

export type SupportRequest = SupportRequestInput & {
  schemaVersion: 1;
  id: string;
  installationId: string;
  userId: string;
  createdAt: string;
  notification: "not_configured" | "delivered" | "failed";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseSupportRequestInput(value: unknown): SupportRequestInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !["kind", "description", "context"].includes(key)) ||
      !SUPPORT_KINDS.includes(value.kind as SupportKind) || typeof value.description !== "string" ||
      !isRecord(value.context)) return null;
  const description = value.description.trim();
  const context = value.context;
  if (!description || description.length > 10_000 || /\p{C}/u.test(description) ||
      Object.keys(context).some((key) => !["pathname", "projectId", "threadId", "viewport"].includes(key)) ||
      typeof context.pathname !== "string" || !context.pathname.startsWith("/") || context.pathname.length > 300 ||
      context.pathname.includes("?") || context.pathname.includes("#") ||
      (context.projectId !== null && (typeof context.projectId !== "string" || !UUID.test(context.projectId))) ||
      (context.threadId !== null && (typeof context.threadId !== "string" || !UUID.test(context.threadId))) ||
      (context.viewport !== "mobile" && context.viewport !== "desktop")) return null;
  return {
    kind: value.kind as SupportKind,
    description,
    context: {
      pathname: context.pathname,
      projectId: context.projectId as string | null,
      threadId: context.threadId as string | null,
      viewport: context.viewport,
    },
  };
}
