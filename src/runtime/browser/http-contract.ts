import type {
  BrowserGatewayCapability,
  BrowserInputCommand,
} from "@/runtime/browser/types";

export type BrowserControlRequest = Readonly<{
  action: "start" | "stop" | "takeover" | "release" | "heartbeat";
}>;

export type BrowserGatewayTokenRequest = Readonly<{
  capabilities: BrowserGatewayCapability[];
  ttlMs?: number;
}>;

export type BrowserViewerCommand =
  | Readonly<{ action: "navigate"; url: string }>
  | Readonly<{ action: "input"; command: BrowserInputCommand }>;

const CONTROL_ACTIONS = ["start", "stop", "takeover", "release", "heartbeat"] as const;
const CAPABILITIES = ["view", "control", "heartbeat", "takeover"] as const;
const MOUSE_EVENTS = ["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"] as const;
const MOUSE_BUTTONS = ["none", "left", "middle", "right"] as const;
const KEY_EVENTS = ["keyDown", "keyUp", "char"] as const;

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

export function parseBrowserControlRequest(value: unknown): BrowserControlRequest | null {
  const record = exactRecord(value, ["action"]);
  return record && typeof record.action === "string" &&
    CONTROL_ACTIONS.includes(record.action as BrowserControlRequest["action"])
    ? { action: record.action as BrowserControlRequest["action"] }
    : null;
}

export function parseBrowserGatewayTokenRequest(value: unknown): BrowserGatewayTokenRequest | null {
  const record = exactRecord(value, ["capabilities"], ["ttlMs"]);
  if (!record || !Array.isArray(record.capabilities) || record.capabilities.length < 1 ||
    record.capabilities.length > CAPABILITIES.length ||
    record.capabilities.some((item) => typeof item !== "string" ||
      !CAPABILITIES.includes(item as BrowserGatewayCapability)) ||
    new Set(record.capabilities).size !== record.capabilities.length ||
    !optionalInteger(record.ttlMs, 1_000, 5 * 60_000)) return null;
  return {
    capabilities: [...record.capabilities].sort() as BrowserGatewayCapability[],
    ...(record.ttlMs === undefined ? {} : { ttlMs: record.ttlMs as number }),
  };
}

function parseMouseCommand(value: unknown): BrowserInputCommand | null {
  const record = exactRecord(
    value,
    ["kind", "event", "x", "y"],
    ["button", "clickCount", "deltaX", "deltaY"],
  );
  if (!record || record.kind !== "mouse" || typeof record.event !== "string" ||
    !MOUSE_EVENTS.includes(record.event as (typeof MOUSE_EVENTS)[number]) ||
    !finiteNumber(record.x, 0, 100_000) || !finiteNumber(record.y, 0, 100_000) ||
    (record.button !== undefined && (typeof record.button !== "string" ||
      !MOUSE_BUTTONS.includes(record.button as (typeof MOUSE_BUTTONS)[number]))) ||
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
    !optionalString(record.text, 4_096) || !optionalInteger(record.modifiers, 0, 15)) return null;
  return record as BrowserInputCommand;
}

export function parseBrowserViewerCommand(value: unknown): BrowserViewerCommand | null {
  const navigation = exactRecord(value, ["action", "url"]);
  if (navigation?.action === "navigate" && typeof navigation.url === "string" &&
    navigation.url.length > 0 && navigation.url.length <= 2_048 &&
    navigation.url.trim() === navigation.url && !/\p{C}/u.test(navigation.url)) {
    try {
      const url = new URL(navigation.url);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        return { action: "navigate", url: url.href };
      }
    } catch {
      if (navigation.url === "about:blank") return { action: "navigate", url: "about:blank" };
    }
    if (navigation.url === "about:blank") return { action: "navigate", url: "about:blank" };
    return null;
  }
  const input = exactRecord(value, ["action", "command"]);
  if (input?.action !== "input") return null;
  const commandRecord = input.command && typeof input.command === "object" && !Array.isArray(input.command)
    ? input.command as Record<string, unknown>
    : null;
  const command = commandRecord?.kind === "mouse"
    ? parseMouseCommand(input.command)
    : parseKeyCommand(input.command);
  return command ? { action: "input", command } : null;
}
