export const AUTOMATION_TIME_ZONES = [
  "Europe/Madrid",
  "UTC",
  "Atlantic/Canary",
] as const;

export type AutomationTimeZone = string;
export type AutomationState = "active" | "paused" | "completed";
export type AutomationRunStatus = "running" | "succeeded" | "failed";

export type AutomationSchedule =
  | { kind: "once"; runAt: string }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekdays: number[]; hour: number; minute: number };

export type AutomationLease = {
  runKey: string;
  ownerId: string;
  /** Changes for every claim, so an expired process cannot settle a newer claim. */
  fenceToken: string;
  scheduledFor: string;
  expiresAt: string;
};

export type AutomationTask = {
  schemaVersion: 1;
  id: string;
  installationId: string;
  userId: string;
  name: string;
  prompt: string;
  projectId: string;
  projectName: string;
  timeZone: AutomationTimeZone;
  schedule: AutomationSchedule;
  state: AutomationState;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: Exclude<AutomationRunStatus, "running"> | null;
  lastRunError: string | null;
  /** Retry retains the same occurrence and its deterministic idempotency key. */
  retryAt: string | null;
  /** A soft-deleted task stays available to the worker only long enough to
   * fence and record an in-flight turn. It is never returned to its owner. */
  deletedAt: string | null;
  /** A pause/delete requested during a lease aborts the turn cooperatively. */
  cancellationRequestedAt: string | null;
  lease: AutomationLease | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  schemaVersion: 1;
  runKey: string;
  taskId: string;
  installationId: string;
  userId: string;
  scheduledFor: string;
  status: AutomationRunStatus;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  threadId: string | null;
  error: string | null;
};

export type AutomationTaskInput = {
  name: string;
  prompt: string;
  projectId: string;
  projectName: string;
  timeZone: string;
  schedule: AutomationSchedule;
};

export type AutomationTaskPatch = Partial<AutomationTaskInput> & {
  state?: "active" | "paused";
};

export type AutomationSnapshot = {
  schemaVersion: 1;
  tasks: AutomationTask[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  if (!isRecord(value)) return false;
  if (value.kind === "once") return Object.keys(value).length === 2 && isIsoDate(value.runAt);
  const hasTime = Number.isInteger(value.hour) && Number(value.hour) >= 0 && Number(value.hour) <= 23 &&
    Number.isInteger(value.minute) && Number(value.minute) >= 0 && Number(value.minute) <= 59;
  if (value.kind === "daily") return Object.keys(value).length === 3 && hasTime;
  if (value.kind !== "weekly" || Object.keys(value).length !== 4 || !hasTime ||
    !Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.length > 7) return false;
  return new Set(value.weekdays).size === value.weekdays.length &&
    value.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

export function parseAutomationInput(value: unknown): AutomationTaskInput | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  const projectId = typeof value.projectId === "string" ? value.projectId : "";
  const projectName = typeof value.projectName === "string" ? value.projectName.trim() : "";
  if (!name || name.length > 100 || !prompt || prompt.length > 20_000 ||
    !/^[0-9a-f-]{36}$/i.test(projectId) || !projectName || projectName.length > 100 ||
    !isValidTimeZone(value.timeZone) || !isAutomationSchedule(value.schedule)) return null;
  return { name, prompt, projectId, projectName, timeZone: value.timeZone, schedule: value.schedule };
}

export function parseAutomationPatch(value: unknown): AutomationTaskPatch | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["name", "prompt", "projectId", "projectName", "timeZone", "schedule", "state"]);
  if (Object.keys(value).length === 0 || Object.keys(value).some((key) => !allowed.has(key))) return null;
  const patch: AutomationTaskPatch = {};
  if ("name" in value) {
    if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100) return null;
    patch.name = value.name.trim();
  }
  if ("prompt" in value) {
    if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.trim().length > 20_000) return null;
    patch.prompt = value.prompt.trim();
  }
  if ("projectId" in value) {
    if (typeof value.projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.projectId)) return null;
    patch.projectId = value.projectId;
  }
  if ("projectName" in value) {
    if (typeof value.projectName !== "string" || !value.projectName.trim() || value.projectName.trim().length > 100) return null;
    patch.projectName = value.projectName.trim();
  }
  if ("timeZone" in value) {
    if (!isValidTimeZone(value.timeZone)) return null;
    patch.timeZone = value.timeZone;
  }
  if ("schedule" in value) {
    if (!isAutomationSchedule(value.schedule)) return null;
    patch.schedule = value.schedule;
  }
  if ("state" in value) {
    if (value.state !== "active" && value.state !== "paused") return null;
    patch.state = value.state;
  }
  return patch;
}
