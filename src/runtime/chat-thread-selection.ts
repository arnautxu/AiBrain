import { CURRENT_THREAD_TOOLSET_REVISION } from "./thread-token";

export function runtimeThreadIdForChatMessage(
  context: { threadId: string; toolsetRevision: string | null } | null,
  _message: string,
) {
  if (!context) return null;
  // Dynamic tools are immutable per runtime thread. The chat route carries
  // durable conversation history into a fresh runtime when the catalog changes.
  return context.toolsetRevision === CURRENT_THREAD_TOOLSET_REVISION ? context.threadId : null;
}
