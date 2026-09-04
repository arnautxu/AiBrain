import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/storage/atomic-file";
import { ResourceLockManager } from "@/storage/resource-lock";
import type { SupportRequest, SupportRequestInput } from "@/support/contracts";

type Snapshot = { schemaVersion: 1; requests: SupportRequest[] };

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export class FileSupportRequestStore {
  private readonly locks: ResourceLockManager;
  constructor(
    private readonly installationId: string,
    private readonly userId: string,
    usersRoot: string,
    private readonly now: () => number = Date.now,
  ) {
    this.filePath = path.join(path.resolve(usersRoot), userId, "support", "requests.json");
    this.locks = new ResourceLockManager({ rootDirectory: path.join(path.resolve(usersRoot), userId, "support", "locks") });
  }
  private readonly filePath: string;

  private async read(): Promise<Snapshot> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!value || typeof value !== "object" || (value as Snapshot).schemaVersion !== 1 ||
          !Array.isArray((value as Snapshot).requests)) throw new Error("Support request store is corrupt.");
      return value as Snapshot;
    } catch (error) {
      if (isMissing(error)) return { schemaVersion: 1, requests: [] };
      throw error;
    }
  }

  async create(input: SupportRequestInput) {
    return this.locks.withLock(`support:${this.installationId}:${this.userId}`, async () => {
      const snapshot = await this.read();
      const recent = snapshot.requests.filter((item) => this.now() - Date.parse(item.createdAt) < 60 * 60_000);
      if (recent.length >= 10) {
        const error = new Error("Has enviado demasiadas solicitudes. Inténtalo de nuevo más tarde.") as Error & { code: string };
        error.code = "SUPPORT_RATE_LIMITED";
        throw error;
      }
      const request: SupportRequest = {
        schemaVersion: 1,
        id: randomUUID(),
        installationId: this.installationId,
        userId: this.userId,
        ...input,
        createdAt: new Date(this.now()).toISOString(),
        notification: "not_configured",
      };
      snapshot.requests.push(request);
      await atomicWriteFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      return request;
    });
  }

  async setNotification(id: string, notification: SupportRequest["notification"]) {
    return this.locks.withLock(`support:${this.installationId}:${this.userId}`, async () => {
      const snapshot = await this.read();
      const request = snapshot.requests.find((item) => item.id === id);
      if (!request) return;
      request.notification = notification;
      await atomicWriteFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    });
  }
}
