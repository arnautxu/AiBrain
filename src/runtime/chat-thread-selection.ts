import { currentThreadToolsetRevision } from "./thread-token";

export function runtimeThreadIdForChatMessage(
  context: { threadId: string; toolsetRevision: string | null } | null,
  _message: string,
  installationId?: string,
) {
  if (!context) return null;
  // Dynamic tools are immutable per runtime thread. The chat route carries
  // durable conversation history into a fresh runtime when the catalog changes.
  return context.toolsetRevision === currentThreadToolsetRevision(installationId) ? context.threadId : null;
}
