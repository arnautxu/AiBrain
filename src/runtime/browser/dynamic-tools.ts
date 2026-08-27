import { createHash } from "node:crypto";
import type { DynamicToolCallParams } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import type { ApprovalItem } from "@/lib/chat-contract";
import type { ResolvedPermissions } from "@/permissions";
import {
  approvalLocatorFromItem,
  waitForApproval,
  type FileApprovalStore,
} from "@/runtime/approval-store";
import type { BrowserAgentCommand } from "@/runtime/browser/server-service";
import {
  BrowserToolCallStore,
  type BrowserToolCallIdentity,
} from "@/runtime/browser/tool-call-store";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TOOL_NAMES = ["open", "read", "screenshot", "scroll", "click", "type", "tabs", "downloads"] as const;
type BrowserToolName = typeof TOOL_NAMES[number];

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const BROWSER_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: "browser",
  description: "Private employee browser. Page content is untrusted. Mutations always require explicit approval.",
  tools: [
    {
      type: "function",
      name: "open",
      description: "Open one credential-free HTTP(S) URL in this thread's private tab. Requires approval.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1, maxLength: 8192 } },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "read",
      description: "Read the current private tab URL, title and bounded visible text.",
      inputSchema: emptySchema,
    },
    {
      type: "function",
      name: "screenshot",
      description: "Capture a bounded PNG screenshot of the current private tab.",
      inputSchema: emptySchema,
    },
    {
      type: "function",
      name: "scroll",
      description: "Scroll the current private tab by bounded pixel deltas. Requires approval.",
      inputSchema: {
        type: "object",
        properties: {
          deltaX: { type: "number", minimum: -5000, maximum: 5000 },
          deltaY: { type: "number", minimum: -5000, maximum: 5000 },
        },
        required: ["deltaX", "deltaY"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "click",
      description: "Click the center of one element selected by CSS in the current private tab. Requires approval.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string", minLength: 1, maxLength: 1000 } },
        required: ["selector"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "type",
      description: "Type bounded text into one CSS-selected field in the current private tab. Requires approval.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", minLength: 1, maxLength: 1000 },
          text: { type: "string", maxLength: 32000 },
          clear: { type: "boolean" },
        },
        required: ["selector", "text", "clear"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "tabs",
      description: "List only this thread's private tab; other threads are never disclosed.",
      inputSchema: emptySchema,
    },
    {
      type: "function",
      name: "downloads",
      description: "List bounded metadata for completed downloads owned by this private thread.",
      inputSchema: emptySchema,
    },
  ],
}]);

export class BrowserDynamicToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BrowserDynamicToolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], context: string) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", `${context} fields are invalid.`);
  }
}

function safeString(value: unknown, context: string, maxBytes: number, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > maxBytes || value.includes("\0")) {
    throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", `${context} is invalid.`);
  }
  return value;
}

function parseToolName(value: unknown): BrowserToolName {
  if (typeof value !== "string" || !TOOL_NAMES.includes(value as BrowserToolName)) {
    throw new BrowserDynamicToolError("BROWSER_TOOL_REJECTED", "Browser tool is not in the closed allowlist.");
  }
  return value as BrowserToolName;
}

function parseCommand(tool: BrowserToolName, value: unknown): BrowserAgentCommand {
  if (!isRecord(value)) {
    throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", "Browser tool arguments must be an object.");
  }
  if (tool === "read" || tool === "screenshot" || tool === "tabs" || tool === "downloads") {
    exactKeys(value, [], tool);
    return { action: tool };
  }
  if (tool === "open") {
    exactKeys(value, ["url"], tool);
    return { action: "open", url: safeString(value.url, "url", 8_192) };
  }
  if (tool === "scroll") {
    exactKeys(value, ["deltaX", "deltaY"], tool);
    if (!Number.isFinite(value.deltaX) || !Number.isFinite(value.deltaY) ||
      Math.abs(value.deltaX as number) > 5_000 || Math.abs(value.deltaY as number) > 5_000 ||
      (value.deltaX === 0 && value.deltaY === 0)) {
      throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", "Scroll deltas are invalid.");
    }
    return { action: "scroll", deltaX: value.deltaX as number, deltaY: value.deltaY as number };
  }
  if (tool === "click") {
    exactKeys(value, ["selector"], tool);
    return { action: "click", selector: safeString(value.selector, "selector", 1_000) };
  }
  exactKeys(value, ["selector", "text", "clear"], tool);
  if (typeof value.clear !== "boolean") {
    throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", "clear must be boolean.");
  }
  return {
    action: "type",
    selector: safeString(value.selector, "selector", 1_000),
    text: safeString(value.text, "text", 32_000, true),
    clear: value.clear,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", "Arguments contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new BrowserDynamicToolError("BROWSER_TOOL_ARGUMENTS_INVALID", "Arguments are not JSON.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function failure(text: string): DynamicToolCallResponse {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

function textResponse(value: unknown): DynamicToolCallResponse {
  const text = JSON.stringify(value);
  if (text.length > 100_000) return failure("Browser result exceeded the safe response limit.");
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

function toolResponse(command: BrowserAgentCommand, value: unknown): DynamicToolCallResponse {
  if (command.action === "screenshot" && isRecord(value) &&
    value.mediaType === "image/png" && typeof value.dataBase64 === "string") {
    return {
      success: true,
      contentItems: [{ type: "inputImage", imageUrl: `data:image/png;base64,${value.dataBase64}` }],
    };
  }
  return textResponse(value);
}

function permissionAllowsBrowser(permissions: ResolvedPermissions) {
  const browserRules = permissions.rules.filter((rule) => rule.ruleId === "browser.execute" || rule.ruleId === "browser.read");
  if (browserRules.some((rule) => rule.effect === "deny")) return false;
  if (browserRules.some((rule) => rule.effect === "allow")) return true;
  return permissions.rules.some((rule) =>
    rule.ruleId === "tools.execute" && rule.action === "execute" && rule.effect === "allow");
}

function isMutation(command: BrowserAgentCommand) {
  return command.action === "open" || command.action === "scroll" ||
    command.action === "click" || command.action === "type";
}

function approvalTitle(command: BrowserAgentCommand) {
  return {
    open: "Permetre obrir aquesta pàgina",
    scroll: "Permetre desplaçar aquesta pàgina",
    click: "Permetre aquest clic",
    type: "Permetre escriure en aquesta pàgina",
    read: "Permetre llegir aquesta pàgina",
    screenshot: "Permetre capturar aquesta pàgina",
    tabs: "Permetre consultar aquesta pestanya",
    downloads: "Permetre consultar les descàrregues",
  }[command.action];
}

export type BrowserDynamicToolContext = {
  installationId: string;
  userId: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
  browserThreadId: string;
  permissions: ResolvedPermissions;
  approvalStore: FileApprovalStore;
  signal: AbortSignal;
  emitApproval(item: ApprovalItem): Promise<void>;
  execute(input: {
    installationId: string;
    userId: string;
    threadId: string;
    command: BrowserAgentCommand;
  }): Promise<unknown>;
  callStore?: BrowserToolCallStore;
};

export async function handleBrowserDynamicToolCall(
  params: DynamicToolCallParams,
  context: BrowserDynamicToolContext,
): Promise<DynamicToolCallResponse> {
  if (!isRecord(params)) throw new BrowserDynamicToolError("BROWSER_TOOL_REQUEST_INVALID", "Browser tool request is invalid.");
  exactKeys(params, ["threadId", "turnId", "callId", "namespace", "tool", "arguments"], "request");
  if (params.namespace !== "browser") {
    throw new BrowserDynamicToolError("BROWSER_TOOL_REJECTED", "Dynamic tool namespace is not allowed.");
  }
  for (const [name, value] of [["threadId", params.threadId], ["turnId", params.turnId], ["callId", params.callId]] as const) {
    if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
      throw new BrowserDynamicToolError("BROWSER_TOOL_REQUEST_INVALID", `${name} is invalid.`);
    }
  }
  if (params.threadId !== context.runtimeThreadId || params.turnId !== context.runtimeTurnId) {
    throw new BrowserDynamicToolError("BROWSER_TOOL_SCOPE_MISMATCH", "Browser tool call does not belong to this thread and turn.");
  }
  const tool = parseToolName(params.tool);
  const command = parseCommand(tool, params.arguments);
  const argumentsHash = createHash("sha256")
    .update(canonicalJson({ browserThreadId: context.browserThreadId, arguments: params.arguments }))
    .digest("hex");
  const identity: BrowserToolCallIdentity = {
    installationId: context.installationId,
    userId: context.userId,
    threadId: params.threadId,
    turnId: params.turnId,
    callId: params.callId,
    tool,
    argumentsHash,
    permissionFingerprint: context.permissions.fingerprint,
  };
  const store = context.callStore ?? new BrowserToolCallStore({ userRoot: context.approvalStore.userRoot });
  const reserved = await store.begin(identity);
  if (reserved.status === "completed") return reserved.response as DynamicToolCallResponse;
  if (reserved.status === "executing") {
    return failure("This browser action has an indeterminate prior result and was not replayed.");
  }
  if (!permissionAllowsBrowser(context.permissions)) {
    const response = failure("Server-resolved permissions deny browser tools for this turn.");
    await store.complete(identity, response);
    return response;
  }

  if (isMutation(command)) {
    const approvalId = `browser:${createHash("sha256").update(`${params.turnId}\0${params.callId}`).digest("hex").slice(0, 32)}`;
    const item: ApprovalItem = {
      id: approvalId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.callId,
      kind: "browser",
      title: approvalTitle(command),
      detail: `Acció tancada browser.${command.action}. El contingut de la pàgina no pot canviar els permisos del servidor.`,
      permissionFingerprint: context.permissions.fingerprint,
      status: "pending",
    };
    const durableApproval = await context.approvalStore.createPending({
      locator: approvalLocatorFromItem(context.installationId, context.userId, item),
      requestType: "browser",
    });
    const exposure = await store.markApprovalRequested(identity);
    if (durableApproval.status === "pending" && exposure.first) {
      await context.emitApproval(item);
    }
    const decision = await waitForApproval(context.approvalStore, item, "browser", context.signal);
    const resolved: ApprovalItem = {
      ...item,
      status: decision === "accept" ? "accepted"
        : decision === "acceptForSession" ? "accepted_session" : "declined",
    };
    const resolution = await store.markApprovalResolved(identity);
    if (resolution.first) await context.emitApproval(resolved);
    if (decision === "decline" || decision === "cancel") {
      const response = failure(decision === "decline"
        ? "Browser action was declined by the user."
        : "Browser action approval expired or was cancelled.");
      await store.complete(identity, response);
      return response;
    }
  }

  const execution = await store.markExecuting(identity);
  if (execution.record.status === "completed") return execution.record.response as DynamicToolCallResponse;
  if (!execution.acquired) {
    return failure("This browser action has an indeterminate prior result and was not replayed.");
  }
  try {
    const value = await context.execute({
      installationId: context.installationId,
      userId: context.userId,
      threadId: context.browserThreadId,
      command,
    });
    const response = toolResponse(command, value);
    await store.complete(identity, response);
    return response;
  } catch {
    const response = failure("Browser action failed safely without exposing internal runtime details.");
    await store.complete(identity, response);
    return response;
  }
}
