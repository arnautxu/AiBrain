import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutomationRun,
  AutomationSnapshot,
  AutomationTask,
  AutomationTaskInput,
  AutomationTaskPatch,
} from "@/automations/contracts";
import {
  isAutomationSchedule,
  isIsoDate,
  isRecord,
  isValidTimeZone,
} from "@/automations/contracts";
import { nextAfterOccurrence, nextScheduledInstant } from "@/automations/schedule";
import {
  atomicWriteJson,
  FileJournal,
  ResourceLockManager,
  type StorageSchema,
} from "@/storage";

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LEASE_MS = 10 * 60_000;

export class AutomationStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AutomationStoreError";
  }
}

function invalid(source: string): never {
  throw new AutomationStoreError("AUTOMATION_STORAGE_CORRUPT", `Datos de automatización no válidos: ${source}.`);
}

function parseLease(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value) || ![4, 5].includes(Object.keys(value).length) ||
    typeof value.runKey !== "string" || value.runKey.length > 200 ||
    typeof value.ownerId !== "string" || value.ownerId.length > 128 ||
    !isIsoDate(value.scheduledFor) || !isIsoDate(value.expiresAt)) invalid("lease");
  if ("fenceToken" in value && (typeof value.fenceToken !== "string" || value.fenceToken.length < 16 || value.fenceToken.length > 128)) invalid("lease");
  // A legacy lease cannot be settled by the fenced runner. The next locked
  // claim replaces it after expiry, without rejecting an in-flight upgrade.
  return {
    ...value,
    fenceToken: typeof value.fenceToken === "string" ? value.fenceToken : "legacy-unfenced",
  } as AutomationTask["lease"];
}

function parseTask(value: unknown): AutomationTask {
  if (!isRecord(value) || value.schemaVersion !== 1 || !UUID_PATTERN.test(String(value.id)) ||
    typeof value.installationId !== "string" || typeof value.userId !== "string" ||
    typeof value.name !== "string" || !value.name || value.name.length > 100 ||
    typeof value.prompt !== "string" || !value.prompt || value.prompt.length > 20_000 ||
    !UUID_PATTERN.test(String(value.projectId)) || typeof value.projectName !== "string" ||
    !isValidTimeZone(value.timeZone) || !isAutomationSchedule(value.schedule) ||
    !["active", "paused", "completed"].includes(String(value.state)) ||
    !(value.nextRunAt === null || isIsoDate(value.nextRunAt)) ||
    !(value.lastRunAt === null || isIsoDate(value.lastRunAt)) ||
    !(value.lastRunStatus === null || value.lastRunStatus === "succeeded" || value.lastRunStatus === "failed") ||
    !(value.lastRunError === null || typeof value.lastRunError === "string") ||
    !(value.retryAt === undefined || value.retryAt === null || isIsoDate(value.retryAt)) ||
    !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) invalid("task");
  return {
    ...value,
    retryAt: value.retryAt ?? null,
    lease: parseLease(value.lease),
  } as AutomationTask;
}

const snapshotSchema: StorageSchema<AutomationSnapshot> = {
  name: "AutomationSnapshot",
  parse(value, source = "AutomationSnapshot") {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks) ||
      Object.keys(value).some((key) => key !== "schemaVersion" && key !== "tasks")) invalid(source);
    return { schemaVersion: 1, tasks: value.tasks.map(parseTask) };
  },
};

const runSchema: StorageSchema<AutomationRun> = {
  name: "AutomationRun",
  parse(value, source = "AutomationRun") {
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.runKey !== "string" ||
      !UUID_PATTERN.test(String(value.taskId)) || typeof value.installationId !== "string" ||
      typeof value.userId !== "string" || !isIsoDate(value.scheduledFor) ||
      !["running", "succeeded", "failed"].includes(String(value.status)) ||
      !Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1 || !isIsoDate(value.startedAt) ||
      !(value.finishedAt === null || isIsoDate(value.finishedAt)) ||
      !(value.threadId === null || UUID_PATTERN.test(String(value.threadId))) ||
      !(value.error === null || typeof value.error === "string")) invalid(source);
    return value as AutomationRun;
  },
};

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function ensurePrivateDirectory(directory: string) {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new AutomationStoreError("AUTOMATION_PATH_UNSAFE", "El directorio de automatizaciones no es privado.");
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}

export type AutomationStoreOptions = {
  installationId: string;
  userId: string;
  usersRoot: string;
  now?: () => number;
  leaseMs?: number;
};

export type ClaimedAutomation = {
  task: AutomationTask;
  runKey: string;
  ownerId: string;
  scheduledFor: string;
};

export class FileAutomationStore {
  readonly root: string;
  readonly tasksPath: string;
  readonly runsPath: string;
  private readonly locks: ResourceLockManager;
  private readonly runs: FileJournal<AutomationRun>;
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(readonly options: AutomationStoreOptions) {
    if (!IDENTITY_PATTERN.test(options.installationId) || !IDENTITY_PATTERN.test(options.userId) ||
      !path.isAbsolute(options.usersRoot)) {
      throw new AutomationStoreError("AUTOMATION_IDENTITY_INVALID", "Identidad o raíz de automatizaciones no válida.");
    }
    this.root = path.join(path.resolve(options.usersRoot), options.userId, "automations");
    this.tasksPath = path.join(this.root, "tasks.json");
    this.runsPath = path.join(this.root, "runs.jsonl");
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.locks = new ResourceLockManager({ rootDirectory: path.join(this.root, "locks"), now: this.now });
    this.runs = new FileJournal({ filePath: this.runsPath, lockManager: this.locks, payloadSchema: runSchema, now: this.now });
  }

  private async prepare() {
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(path.join(this.root, "locks"));
  }

  private async readUnlocked(): Promise<AutomationSnapshot> {
    try {
      return snapshotSchema.parse(JSON.parse(await readFile(this.tasksPath, "utf8")), this.tasksPath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { schemaVersion: 1, tasks: [] };
      throw error;
    }
  }

  private assertOwnership(task: AutomationTask) {
    if (task.installationId !== this.options.installationId || task.userId !== this.options.userId) {
      throw new AutomationStoreError("AUTOMATION_IDENTITY_MISMATCH", "La automatización pertenece a otro usuario o instalación.");
    }
  }

  private async mutate<T>(operation: (snapshot: AutomationSnapshot) => T | Promise<T>) {
    await this.prepare();
    return this.locks.withLock("automation-tasks", async () => {
      const snapshot = await this.readUnlocked();
      snapshot.tasks.forEach((task) => this.assertOwnership(task));
      const result = await operation(snapshot);
      await atomicWriteJson(this.tasksPath, snapshot, snapshotSchema);
      return result;
    });
  }

  async list() {
    await this.prepare();
    const snapshot = await this.readUnlocked();
    snapshot.tasks.forEach((task) => this.assertOwnership(task));
    return snapshot.tasks.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(input: AutomationTaskInput) {
    const now = new Date(this.now());
    const nextRunAt = nextScheduledInstant(input.schedule, input.timeZone, new Date(now.getTime() - 1));
    if (!nextRunAt) throw new AutomationStoreError("AUTOMATION_DATE_PAST", "La fecha de ejecución ya ha pasado.");
    const task: AutomationTask = {
      schemaVersion: 1,
      id: randomUUID(),
      installationId: this.options.installationId,
      userId: this.options.userId,
      ...input,
      state: "active",
      nextRunAt,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      retryAt: null,
      lease: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.mutate((snapshot) => snapshot.tasks.push(task));
    return task;
  }

  async update(taskId: string, patch: AutomationTaskPatch) {
    if (!UUID_PATTERN.test(taskId)) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.");
    return this.mutate((snapshot) => {
      const index = snapshot.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.");
      const current = snapshot.tasks[index];
      this.assertOwnership(current);
      const state = patch.state ?? current.state;
      const next: AutomationTask = {
        ...current,
        ...patch,
        state,
        lease: state === "paused" ? null : current.lease,
        retryAt: state === "paused" || patch.schedule || patch.timeZone ? null : current.retryAt,
        updatedAt: new Date(this.now()).toISOString(),
      };
      if (state === "active" && (patch.schedule || patch.timeZone || current.state !== "active")) {
        next.nextRunAt = nextScheduledInstant(next.schedule, next.timeZone, new Date(this.now() - 1));
        if (!next.nextRunAt) throw new AutomationStoreError("AUTOMATION_DATE_PAST", "La fecha de ejecución ya ha pasado.");
      }
      snapshot.tasks[index] = next;
      return next;
    });
  }

  async delete(taskId: string) {
    return this.mutate((snapshot) => {
      const index = snapshot.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.");
      this.assertOwnership(snapshot.tasks[index]);
      snapshot.tasks.splice(index, 1);
      return true;
    });
  }

  async claimDue(ownerId: string, limit = 10): Promise<ClaimedAutomation[]> {
    if (!IDENTITY_PATTERN.test(ownerId)) throw new AutomationStoreError("AUTOMATION_OWNER_INVALID", "Identidad de worker no válida.");
    return this.mutate((snapshot) => {
      const now = this.now();
      const claims: ClaimedAutomation[] = [];
      for (const task of snapshot.tasks.toSorted((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))) {
        const dueAt = task.retryAt ?? task.nextRunAt;
        if (claims.length >= limit || task.state !== "active" || !task.nextRunAt || !dueAt ||
          new Date(dueAt).getTime() > now ||
          (task.lease && new Date(task.lease.expiresAt).getTime() > now)) continue;
        const scheduledFor = task.nextRunAt;
        const runKey = `${task.id}:${scheduledFor}`;
        task.lease = {
          runKey,
          ownerId,
          fenceToken: randomUUID(),
          scheduledFor,
          expiresAt: new Date(now + this.leaseMs).toISOString(),
        };
        task.updatedAt = new Date(now).toISOString();
        claims.push({ task: { ...task }, runKey, ownerId, scheduledFor });
      }
      return claims;
    });
  }

  async settle(claim: ClaimedAutomation, outcome: { status: "succeeded" | "failed"; error?: string | null }) {
    return this.mutate((snapshot) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === claim.task.id);
      if (!task) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.");
      this.assertOwnership(task);
      if (!task.lease || task.lease.runKey !== claim.runKey || task.lease.ownerId !== claim.ownerId ||
        task.lease.fenceToken !== claim.task.lease?.fenceToken) {
        throw new AutomationStoreError("AUTOMATION_LEASE_LOST", "La concesión de ejecución ya no pertenece a este worker.");
      }
      task.lastRunAt = new Date(this.now()).toISOString();
      task.lastRunStatus = outcome.status;
      task.lastRunError = outcome.status === "failed" ? (outcome.error ?? "Error de ejecución") : null;
      // Bound restart catch-up to one occurrence. A long outage must not turn
      // into a burst of every missed daily/weekly job.
      task.nextRunAt = nextAfterOccurrence(task.schedule, task.timeZone,
        new Date(Math.max(this.now(), new Date(claim.scheduledFor).getTime())).toISOString());
      task.state = task.nextRunAt ? "active" : "completed";
      task.retryAt = null;
      task.lease = null;
      task.updatedAt = task.lastRunAt;
      return { ...task };
    });
  }

  async renewLease(claim: ClaimedAutomation) {
    return this.mutate((snapshot) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === claim.task.id);
      if (!task?.lease || task.lease.runKey !== claim.runKey || task.lease.ownerId !== claim.ownerId ||
        task.lease.fenceToken !== claim.task.lease?.fenceToken) {
        throw new AutomationStoreError("AUTOMATION_LEASE_LOST", "La concesión de ejecución ya no pertenece a este worker.");
      }
      task.lease.expiresAt = new Date(this.now() + this.leaseMs).toISOString();
      task.updatedAt = new Date(this.now()).toISOString();
      return task.lease.expiresAt;
    });
  }

  async appendRun(run: AutomationRun) {
    this.assertRunOwnership(run);
    await this.prepare();
    return this.runs.append(run);
  }

  async retry(claim: ClaimedAutomation, outcome: { error: string; retryAt: string }) {
    if (!isIsoDate(outcome.retryAt)) throw new AutomationStoreError("AUTOMATION_RETRY_INVALID", "La reprogramación no es válida.");
    return this.mutate((snapshot) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === claim.task.id);
      if (!task) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.");
      this.assertOwnership(task);
      if (!task.lease || task.lease.runKey !== claim.runKey || task.lease.ownerId !== claim.ownerId ||
        task.lease.fenceToken !== claim.task.lease?.fenceToken) {
        throw new AutomationStoreError("AUTOMATION_LEASE_LOST", "La concesión de ejecución ya no pertenece a este worker.");
      }
      task.lastRunAt = new Date(this.now()).toISOString();
      task.lastRunStatus = "failed";
      task.lastRunError = outcome.error;
      task.retryAt = outcome.retryAt;
      task.lease = null;
      task.updatedAt = task.lastRunAt;
      return { ...task };
    });
  }

  private assertRunOwnership(run: AutomationRun) {
    if (run.installationId !== this.options.installationId || run.userId !== this.options.userId) {
      throw new AutomationStoreError("AUTOMATION_IDENTITY_MISMATCH", "La ejecución pertenece a otro usuario o instalación.");
    }
  }

  async listRuns(taskId?: string) {
    await this.prepare();
    const entries = await this.runs.read();
    return entries.map((entry) => entry.payload).filter((run) => {
      this.assertRunOwnership(run);
      return !taskId || run.taskId === taskId;
    });
  }

  async latestRun(runKey: string) {
    return (await this.listRuns()).filter((run) => run.runKey === runKey).at(-1) ?? null;
  }
}
