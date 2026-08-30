import "server-only";

import path from "node:path";
import {
  atomicWriteJson,
  defineVersionedSchema,
  expectArray,
  expectIsoDate,
  expectString,
  recoverAtomicJsonFile,
  ResourceLockManager,
} from "@/storage";

export type AutomationThreadDelivery = {
  schemaVersion: 1;
  runKey: string;
  taskId: string;
  ownerUserId: string;
  projectId: string;
  threadId: string;
  createdAt: string;
};

type AutomationAudienceState = {
  schemaVersion: 1;
  installationId: string;
  updatedAt: string;
  deliveries: AutomationThreadDelivery[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTALLATION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const deliverySchema = defineVersionedSchema<AutomationThreadDelivery>({
  name: "AutomationThreadDelivery",
  schemaVersion: 1,
  keys: ["runKey", "taskId", "ownerUserId", "projectId", "threadId", "createdAt"],
  parse(record, context) {
    return {
      schemaVersion: 1,
      runKey: expectString(record.runKey, context.at("runKey"), { minLength: 38, maxLength: 200 }),
      taskId: expectString(record.taskId, context.at("taskId"), { minLength: 36, maxLength: 36, pattern: UUID }),
      ownerUserId: expectString(record.ownerUserId, context.at("ownerUserId"), { minLength: 36, maxLength: 36, pattern: UUID }),
      projectId: expectString(record.projectId, context.at("projectId"), { minLength: 36, maxLength: 36, pattern: UUID }),
      threadId: expectString(record.threadId, context.at("threadId"), { minLength: 36, maxLength: 36, pattern: UUID }),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
    };
  },
});

const stateSchema = defineVersionedSchema<AutomationAudienceState>({
  name: "AutomationAudienceState",
  schemaVersion: 1,
  keys: ["installationId", "updatedAt", "deliveries"],
  parse(record, context) {
    const deliveries = expectArray(record.deliveries, context.at("deliveries"),
      (value, item) => deliverySchema.parse(value, `${item.source}${item.path}`), { maxLength: 100_000 });
    if (new Set(deliveries.map(({ runKey }) => runKey)).size !== deliveries.length ||
      new Set(deliveries.map(({ threadId }) => threadId)).size !== deliveries.length) {
      context.at("deliveries").fail("run and thread ids must be unique");
    }
    return {
      schemaVersion: 1,
      installationId: expectString(record.installationId, context.at("installationId"), { minLength: 2, maxLength: 63, pattern: INSTALLATION_ID }),
      updatedAt: expectIsoDate(record.updatedAt, context.at("updatedAt")),
      deliveries,
    };
  },
});

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export class AutomationAudienceStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AutomationAudienceStoreError";
  }
}

export class FileAutomationAudienceStore {
  private readonly filePath: string;
  private readonly locks: ResourceLockManager;
  private readonly now: () => number;

  constructor(readonly options: { installationId: string; dataRoot: string; now?: () => number }) {
    if (!INSTALLATION_ID.test(options.installationId) || !path.isAbsolute(options.dataRoot)) {
      throw new AutomationAudienceStoreError("AUTOMATION_AUDIENCE_STORAGE_INVALID", "El almacén de audiencia no es válido.");
    }
    const root = path.join(path.resolve(options.dataRoot), "automation-audience");
    this.filePath = path.join(root, "thread-deliveries.json");
    this.locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
    this.now = options.now ?? Date.now;
  }

  private empty(): AutomationAudienceState {
    return {
      schemaVersion: 1,
      installationId: this.options.installationId,
      updatedAt: new Date(this.now()).toISOString(),
      deliveries: [],
    };
  }

  private async readUnlocked() {
    try {
      const state = (await recoverAtomicJsonFile(this.filePath, stateSchema)).value;
      if (state.installationId !== this.options.installationId) {
        throw new AutomationAudienceStoreError("AUTOMATION_TENANT_MISMATCH", "La entrega pertenece a otra instalación.");
      }
      return state;
    } catch (error) {
      if (isMissing(error)) return this.empty();
      throw error;
    }
  }

  async record(input: Omit<AutomationThreadDelivery, "schemaVersion" | "createdAt">) {
    return this.locks.withLock(`automation-audience:${this.options.installationId}`, async () => {
      const state = await this.readUnlocked();
      const existing = state.deliveries.find(({ runKey }) => runKey === input.runKey);
      if (existing) {
        const matches = existing.taskId === input.taskId && existing.ownerUserId === input.ownerUserId &&
          existing.projectId === input.projectId && existing.threadId === input.threadId;
        if (!matches) {
          throw new AutomationAudienceStoreError("AUTOMATION_DELIVERY_CONFLICT", "La ejecución ya está vinculada a otro resultado.");
        }
        return existing;
      }
      if (state.deliveries.some(({ threadId }) => threadId === input.threadId)) {
        throw new AutomationAudienceStoreError("AUTOMATION_DELIVERY_CONFLICT", "La conversación ya pertenece a otra ejecución.");
      }
      const createdAt = new Date(this.now()).toISOString();
      const delivery: AutomationThreadDelivery = { schemaVersion: 1, ...input, createdAt };
      state.deliveries.push(delivery);
      state.updatedAt = createdAt;
      await atomicWriteJson(this.filePath, state, stateSchema, { mode: 0o600 });
      return delivery;
    });
  }

  async list() {
    return this.locks.withLock(`automation-audience:${this.options.installationId}`,
      async () => structuredClone((await this.readUnlocked()).deliveries));
  }

  async findByThread(threadId: string) {
    if (!UUID.test(threadId)) return null;
    return (await this.list()).find((delivery) => delivery.threadId === threadId) ?? null;
  }
}
