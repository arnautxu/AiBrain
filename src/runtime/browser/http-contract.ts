import type {
  BrowserGatewayCapability,
  BrowserInputCommand,
  BrowserViewerHistoryAction,
  BrowserViewerControlBinding,
} from "@/runtime/browser/types";

export type BrowserControlRequest = Readonly<{
  action: "start" | "stop" | "takeover" | "release" | "heartbeat";
  binding?: BrowserViewerControlBinding;
}>;

export type BrowserGatewayTokenRequest = Readonly<{
  threadId: string;
  capabilities: BrowserGatewayCapability[];
  ttlMs?: number;
}>;

export type BrowserViewerCommand =
  | Readonly<{ threadId: string; action: "navigate"; url: string }>
  | Readonly<{ threadId: string; action: "history"; direction: BrowserViewerHistoryAction }>
  | Readonly<{ threadId: string; action: "input"; command: BrowserInputCommand }>
  | Readonly<{ threadId: string; action: "inputs"; commands: BrowserInputCommand[] }>;

const CONTROL_ACTIONS = ["start", "stop", "takeover", "release", "heartbeat"] as const;
const CAPABILITIES = ["view", "control", "heartbeat", "takeover"] as const;
const MOUSE_EVENTS = ["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"] as const;
const MOUSE_BUTTONS = ["none", "left", "middle", "right"] as const;
const KEY_EVENTS = ["keyDown", "keyUp", "char"] as const;
const HISTORY_ACTIONS = ["back", "forward", "reload"] as const;

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))) return null;
  return record;
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum);
}

function optionalString(value: unknown, maximum: number) {
  return value === undefined || (
    typeof value === "string" && value.length <= maximum && !/\p{C}/u.test(value)
  );
}

function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

export function parseBrowserControlRequest(value: unknown): BrowserControlRequest | null {
  const record = exactRecord(value, ["action"], ["binding"]);
  if (!record || typeof record.action !== "string" ||
    !CONTROL_ACTIONS.includes(record.action as BrowserControlRequest["action"])) return null;
  const action = record.action as BrowserControlRequest["action"];
  if (record.binding === undefined) return { action };
  const binding = exactRecord(record.binding, ["attachmentId", "browserSessionId"]);
  if (!binding || !canonicalUuid(binding.attachmentId) || !canonicalUuid(binding.browserSessionId) ||
    action === "start" || action === "stop") return null;
  return { action, binding: { attachmentId: binding.attachmentId, browserSessionId: binding.browserSessionId } };
}

export function parseBrowserGatewayTokenRequest(value: unknown): BrowserGatewayTokenRequest | null {
  const record = exactRecord(value, ["threadId", "capabilities"], ["ttlMs"]);
  if (!record || !Array.isArray(record.capabilities) || record.capabilities.length < 1 ||
    record.capabilities.length > CAPABILITIES.length ||
    record.capabilities.some((item) => typeof item !== "string" ||
      !CAPABILITIES.includes(item as BrowserGatewayCapability)) ||
    new Set(record.capabilities).size !== record.capabilities.length ||
    !optionalInteger(record.ttlMs, 1_000, 5 * 60_000) || !canonicalUuid(record.threadId)) return null;
  return {
    threadId: record.threadId,
    capabilities: [...record.capabilities].sort() as BrowserGatewayCapability[],
    ...(record.ttlMs === undefined ? {} : { ttlMs: record.ttlMs as number }),
  };
}

function parseMouseCommand(value: unknown): BrowserInputCommand | null {
  const record = exactRecord(
    value,
    ["kind", "event", "x", "y"],
    ["button", "buttons", "clickCount", "deltaX", "deltaY"],
  );
  if (!record || record.kind !== "mouse" || typeof record.event !== "string" ||
    !MOUSE_EVENTS.includes(record.event as (typeof MOUSE_EVENTS)[number]) ||
    !finiteNumber(record.x, 0, 100_000) || !finiteNumber(record.y, 0, 100_000) ||
    (record.button !== undefined && (typeof record.button !== "string" ||
      !MOUSE_BUTTONS.includes(record.button as (typeof MOUSE_BUTTONS)[number]))) ||
    !optionalInteger(record.buttons, 0, 7) ||
    !optionalInteger(record.clickCount, 0, 3) ||
    (record.deltaX !== undefined && !finiteNumber(record.deltaX, -100_000, 100_000)) ||
    (record.deltaY !== undefined && !finiteNumber(record.deltaY, -100_000, 100_000))) return null;
  return record as BrowserInputCommand;
}

function parseKeyCommand(value: unknown): BrowserInputCommand | null {
  const record = exactRecord(value, ["kind", "event", "key"], ["code", "text", "modifiers"]);
  if (!record || record.kind !== "key" || typeof record.event !== "string" ||
    !KEY_EVENTS.includes(record.event as (typeof KEY_EVENTS)[number]) ||
    typeof record.key !== "string" || record.key.length < 1 || record.key.length > 128 ||
    /\p{C}/u.test(record.key) || !optionalString(record.code, 128) ||
    !(record.text === undefined || (typeof record.text === "string" && record.text.length <= 4_096 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\p{Cs}/u.test(record.text))) ||
    !optionalInteger(record.modifiers, 0, 15)) return null;
  return record as BrowserInputCommand;
}

export function parseBrowserViewerCommand(value: unknown): BrowserViewerCommand | null {
  const navigation = exactRecord(value, ["threadId", "action", "url"]);
  if (navigation?.action === "navigate" && typeof navigation.url === "string" &&
    canonicalUuid(navigation.threadId) &&
    navigation.url.length > 0 && navigation.url.length <= 2_048 &&
    navigation.url.trim() === navigation.url && !/\p{C}/u.test(navigation.url)) {
    try {
      const url = new URL(navigation.url);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        return { threadId: navigation.threadId, action: "navigate", url: url.href };
      }
    } catch {
      if (navigation.url === "about:blank") {
        return { threadId: navigation.threadId, action: "navigate", url: "about:blank" };
      }
    }
    if (navigation.url === "about:blank") {
      return { threadId: navigation.threadId, action: "navigate", url: "about:blank" };
    }
    return null;
  }
  const history = exactRecord(value, ["threadId", "action", "direction"]);
  if (history?.action === "history" && canonicalUuid(history.threadId) &&
    typeof history.direction === "string" &&
    HISTORY_ACTIONS.includes(history.direction as BrowserViewerHistoryAction)) {
    return {
      threadId: history.threadId,
      action: "history",
      direction: history.direction as BrowserViewerHistoryAction,
    };
  }
  const batch = exactRecord(value, ["threadId", "action", "commands"]);
  if (batch?.action === "inputs") {
    if (!canonicalUuid(batch.threadId) || !Array.isArray(batch.commands) ||
      batch.commands.length < 1 || batch.commands.length > 32) return null;
    const commands: BrowserInputCommand[] = [];
    for (const raw of batch.commands) {
      const parsed = parseMouseCommand(raw) ?? parseKeyCommand(raw);
      if (!parsed) return null;
      commands.push(parsed);
    }
    return { threadId: batch.threadId, action: "inputs", commands };
  }
  const input = exactRecord(value, ["threadId", "action", "command"]);
  if (input?.action !== "input" || !canonicalUuid(input.threadId)) return null;
  const commandRecord = input.command && typeof input.command === "object" && !Array.isArray(input.command)
    ? input.command as Record<string, unknown>
    : null;
  const command = commandRecord?.kind === "mouse"
    ? parseMouseCommand(input.command)
    : parseKeyCommand(input.command);
  return command ? { threadId: input.threadId, action: "input", command } : null;
}

export function parseBrowserViewerThreadQuery(searchParams: URLSearchParams) {
  if ([...searchParams.keys()].some((key) => key !== "threadId") ||
    searchParams.getAll("threadId").length !== 1) return null;
  const threadId = searchParams.get("threadId");
  return canonicalUuid(threadId) ? threadId : null;
}
