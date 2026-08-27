import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/storage";

export type AutomationWorkerStatus = {
  workerId: string;
  processId: number;
  heartbeatAt: string;
  intervalMs: number;
};

function statusPath(dataRoot: string) {
  return path.join(dataRoot, "automations", "worker-status.json");
}

export async function writeAutomationWorkerStatus(dataRoot: string, value: AutomationWorkerStatus) {
  await atomicWriteFile(statusPath(dataRoot), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function readAutomationWorkerStatus(dataRoot: string, now = Date.now()) {
  try {
    const value: unknown = JSON.parse(await readFile(statusPath(dataRoot), "utf8"));
    if (!value || typeof value !== "object" || !("workerId" in value) || typeof value.workerId !== "string" ||
      !("processId" in value) || !Number.isInteger(value.processId) || !("heartbeatAt" in value) ||
      typeof value.heartbeatAt !== "string" || Number.isNaN(Date.parse(value.heartbeatAt)) ||
      !("intervalMs" in value) || typeof value.intervalMs !== "number" || !Number.isInteger(value.intervalMs) || value.intervalMs < 1_000) return null;
    const status = value as AutomationWorkerStatus;
    return { ...status, online: now - new Date(status.heartbeatAt).getTime() <= Math.max(15_000, status.intervalMs * 3) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    return null;
  }
}
