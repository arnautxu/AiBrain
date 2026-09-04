import { CURRENT_THREAD_TOOLSET_REVISION } from "./thread-token";
import { needsAutomationChatTools } from "@/automations/chat-tools";

export function runtimeThreadIdForChatMessage(
  context: { threadId: string; toolsetRevision: string | null } | null,
  message: string,
) {
  if (!context) return null;
  return context.toolsetRevision !== CURRENT_THREAD_TOOLSET_REVISION &&
    needsAutomationChatTools(message)
    ? null
    : context.threadId;
}
