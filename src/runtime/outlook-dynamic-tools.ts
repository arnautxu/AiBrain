import type { DynamicToolCallParams } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import type { InstallationConfig } from "@/config/installation-schema";
import { readOutlookMessage, searchOutlookMessages } from "@/connectors/outlook-api";
import { outlookAccessForIdentity } from "@/connectors/outlook-server-service";

export const AIBRAIN_OUTLOOK_TOOL_NAMESPACE = "aibrain_outlook";
export const OUTLOOK_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_OUTLOOK_TOOL_NAMESPACE,
  description: "Read the authenticated employee's Outlook mailbox only when @outlook was explicitly selected for this turn.",
  tools: [
    { type: "function", name: "search", description: "Search Outlook mail. Read-only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 500 }, maxResults: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false } },
    { type: "function", name: "read", description: "Read one Outlook message by its id. Read-only.", inputSchema: { type: "object", properties: { messageId: { type: "string", minLength: 4, maxLength: 512 } }, required: ["messageId"], additionalProperties: false } },
  ],
}]);

function result(success: boolean, value: unknown): DynamicToolCallResponse { return { success, contentItems: [{ type: "inputText", text: typeof value === "string" ? value : JSON.stringify(value) }] }; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

export async function handleOutlookDynamicToolCall(params: DynamicToolCallParams, context: { config: Readonly<InstallationConfig>; installationId: string; userId: string; runtimeThreadId: string; runtimeTurnId: string; outlookSelected: boolean; fetcher?: typeof fetch }): Promise<DynamicToolCallResponse> {
  if (params.namespace !== AIBRAIN_OUTLOOK_TOOL_NAMESPACE || (params.tool !== "search" && params.tool !== "read")) return result(false, "Outlook tool is not supported.");
  if (!context.outlookSelected) return result(false, "@outlook is not authorized for this turn.");
  if (context.installationId !== context.config.installationId || params.threadId !== context.runtimeThreadId || params.turnId !== context.runtimeTurnId || !record(params.arguments)) return result(false, "Outlook tool identity does not match this turn.");
  try {
    const { accessToken } = await outlookAccessForIdentity(context.config, context.userId, context.fetcher);
    if (params.tool === "search") {
      if (typeof params.arguments.query !== "string" || params.arguments.query.trim().length === 0 || params.arguments.query.length > 500 || !(params.arguments.maxResults === undefined || Number.isSafeInteger(params.arguments.maxResults) && Number(params.arguments.maxResults) >= 1 && Number(params.arguments.maxResults) <= 20)) return result(false, "Outlook search arguments are invalid.");
      return result(true, await searchOutlookMessages(context.fetcher ?? fetch, accessToken, params.arguments.query.trim(), Number(params.arguments.maxResults ?? 10)));
    }
    if (typeof params.arguments.messageId !== "string") return result(false, "Outlook message id is invalid.");
    return result(true, await readOutlookMessage(context.fetcher ?? fetch, accessToken, params.arguments.messageId));
  } catch (error) { return result(false, error instanceof Error ? error.message : "Outlook request failed."); }
}
