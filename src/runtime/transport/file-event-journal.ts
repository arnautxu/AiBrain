import path from "node:path";
import type {
  AppServerEvent,
  ReplayCursor,
  TransportEventJournal,
} from "@/runtime/transport/contracts";
import { TransportProtocolError, parseAppServerEvent } from "@/runtime/transport/wire-protocol";
import { FileJournal } from "@/storage/journal";
import type { ResourceLockManager } from "@/storage/resource-lock";
import type { StorageSchema } from "@/storage/schema";

const appServerEventSchema: StorageSchema<AppServerEvent> = Object.freeze({
  name: "AppServerEvent@codex-0.149.1",
  parse(value: unknown) {
    return parseAppServerEvent(value);
  },
});

export type FileTransportEventJournalOptions = {
  filePath: string;
  lockManager: ResourceLockManager;
};

/** Durable per-worker transport cursor and event log. */
export class FileTransportEventJournal implements TransportEventJournal {
  readonly filePath: string;
  private readonly journal: FileJournal<AppServerEvent>;

  constructor(options: FileTransportEventJournalOptions) {
    this.filePath = path.resolve(options.filePath);
    this.journal = new FileJournal({
      filePath: this.filePath,
      lockManager: options.lockManager,
      payloadSchema: appServerEventSchema,
    });
  }

  async loadCursor(): Promise<ReplayCursor | null> {
    const last = (await this.journal.read()).at(-1)?.payload;
    return last ? { eventId: last.eventId, sequence: last.sequence } : null;
  }

  async append(event: AppServerEvent) {
    const validated = appServerEventSchema.parse(event);
    const appended = await this.journal.appendIf(validated, (entries) => {
      const duplicate = entries.find((entry) => entry.payload.eventId === validated.eventId);
      if (duplicate) {
        if (duplicate.payload.sequence !== validated.sequence) {
          throw new TransportProtocolError("Worker reused an eventId with a different sequence.");
        }
        return false;
      }
      const last = entries.at(-1)?.payload;
      const expected = (last?.sequence ?? 0) + 1;
      if (validated.sequence !== expected) {
        throw new TransportProtocolError(
          `Durable event journal expected sequence ${expected}, received ${validated.sequence}.`,
        );
      }
      return true;
    });
    return appended !== null;
  }

  async verifyAndRepair() {
    return this.journal.verifyAndRepair();
  }
}
