import path from "node:path";
import type {
  AppServerEvent,
  ReplayCursor,
  TransportEventJournal,
} from "@/runtime/transport/contracts";
import { TransportProtocolError, parseAppServerEvent } from "@/runtime/transport/wire-protocol";
import { FileJournal } from "@/storage/journal";
import { atomicWriteJson, readValidatedJson } from "@/storage/atomic-file";
import type { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectInteger,
  expectString,
  type StorageSchema,
} from "@/storage/schema";

const appServerEventSchema: StorageSchema<AppServerEvent> = Object.freeze({
  name: "AppServerEvent@codex-0.149.1",
  parse(value: unknown) {
    return parseAppServerEvent(value);
  },
});

type DeliveryCursorRecord = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
};

const deliveryCursorSchema = defineVersionedSchema<DeliveryCursorRecord>({
  name: "TransportDeliveryCursor",
  schemaVersion: 1,
  keys: ["eventId", "sequence"],
  parse(record, context) {
    return {
      schemaVersion: 1,
      eventId: expectString(record.eventId, context.at("eventId"), {
        minLength: 1,
        maxLength: 256,
      }),
      sequence: expectInteger(record.sequence, context.at("sequence"), { minimum: 1 }),
    };
  },
});

export type FileTransportEventJournalOptions = {
  filePath: string;
  lockManager: ResourceLockManager;
  maxRetainedDeliveredEvents?: number;
};

/** Durable per-worker transport cursor and event log. */
export class FileTransportEventJournal implements TransportEventJournal {
  readonly filePath: string;
  private readonly journal: FileJournal<AppServerEvent>;
  private readonly lockManager: ResourceLockManager;
  private readonly deliveryCursorPath: string;
  private readonly maxRetainedDeliveredEvents: number;
  private readonly verifiedEvents = new Map<number, string>();

  constructor(options: FileTransportEventJournalOptions) {
    this.filePath = path.resolve(options.filePath);
    this.lockManager = options.lockManager;
    this.deliveryCursorPath = `${this.filePath}.delivery.json`;
    this.maxRetainedDeliveredEvents = options.maxRetainedDeliveredEvents ?? 256;
    if (!Number.isSafeInteger(this.maxRetainedDeliveredEvents) ||
        this.maxRetainedDeliveredEvents < 1 || this.maxRetainedDeliveredEvents > 65_536) {
      throw new Error("Delivered event retention must be between 1 and 65536.");
    }
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
    if (appended !== null) this.rememberVerified(validated);
    return appended !== null;
  }

  async readEvents(afterSequence = 0, limit = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 ||
        !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Transport event read bounds are invalid.");
    }
    return (await this.journal.read())
      .map((entry) => entry.payload)
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit);
  }

  async loadDeliveryCursor() {
    try {
      return await readValidatedJson(this.deliveryCursorPath, deliveryCursorSchema);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async readUndelivered(limit: number, afterSequence = 0) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Undelivered event limit must be positive.");
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Undelivered event cursor must be a non-negative safe integer.");
    }
    return this.lockManager.withLock(`transport-delivery:${this.deliveryCursorPath}`, async () => {
      const cursor = await this.loadDeliveryCursor();
      if (cursor) {
        const persisted = (await this.readEvents(cursor.sequence - 1, 1))[0];
        if (!persisted || persisted.eventId !== cursor.eventId || persisted.sequence !== cursor.sequence) {
          throw new TransportProtocolError("Transport delivery cursor does not match the durable event journal.");
        }
      }
      const events = await this.readEvents(Math.max(cursor?.sequence ?? 0, afterSequence), limit);
      for (const event of events) this.rememberVerified(event);
      return events;
    });
  }

  async markDelivered(event: AppServerEvent) {
    const validated = appServerEventSchema.parse(event);
    return this.markDeliveredIdentity(validated.eventId, validated.sequence);
  }

  async markDeliveredIdentity(eventId: string, sequence: number) {
    if (!eventId || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new TransportProtocolError("Transport delivery identity is invalid.");
    }
    await this.lockManager.withLock(`transport-delivery:${this.deliveryCursorPath}`, async () => {
      const cursor = await this.loadDeliveryCursor();
      if (cursor?.eventId === eventId && cursor.sequence === sequence) return;
      const expected = (cursor?.sequence ?? 0) + 1;
      if (sequence !== expected) {
        throw new TransportProtocolError(
          `Transport delivery expected sequence ${expected}, received ${sequence}.`,
        );
      }
      const verifiedEventId = this.verifiedEvents.get(sequence);
      const persisted = verifiedEventId === undefined
        ? (await this.readEvents(sequence - 1, 1))[0]
        : null;
      if ((verifiedEventId === undefined && (!persisted || persisted.eventId !== eventId || persisted.sequence !== sequence)) ||
          (verifiedEventId !== undefined && verifiedEventId !== eventId)) {
        throw new TransportProtocolError("Cannot acknowledge an event absent from the durable journal.");
      }
      await atomicWriteJson(this.deliveryCursorPath, {
        schemaVersion: 1,
        eventId,
        sequence,
      }, deliveryCursorSchema, { mode: 0o600 });
      this.verifiedEvents.delete(sequence);
      const compactionBoundary = sequence % this.maxRetainedDeliveredEvents === 0
        || sequence === this.maxRetainedDeliveredEvents * 2 + 1;
      if (!compactionBoundary) return;
      const retainAfter = Math.max(0, sequence - this.maxRetainedDeliveredEvents);
      await this.journal.compact((entries) => {
        if (entries.length <= this.maxRetainedDeliveredEvents * 2) return undefined;
        const retained = entries
          .map((entry) => entry.payload)
          .filter((persisted) => persisted.sequence > retainAfter);
        // A large recovery backlog advances one event at a time. Rewriting the
        // complete journal for every acknowledgement creates quadratic I/O,
        // so compact only after at least one retention window is reclaimable.
        if (entries.length - retained.length < this.maxRetainedDeliveredEvents) {
          return undefined;
        }
        return retained;
      });
    });
  }

  /**
   * Reconcile the gateway delivery cursor with a client resume cursor that was
   * already validated against this durable journal. Event acknowledgements are
   * cumulative: after a reconnect the client may have compacted intermediate
   * events, so requiring one ACK for every historical sequence can leave the
   * gateway cursor permanently behind.
   */
  async reconcileDeliveryCursor(eventId: string, sequence: number) {
    if (!eventId || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new TransportProtocolError("Transport delivery identity is invalid.");
    }
    await this.lockManager.withLock(`transport-delivery:${this.deliveryCursorPath}`, async () => {
      const cursor = await this.loadDeliveryCursor();
      if (cursor && sequence < cursor.sequence) {
        throw new TransportProtocolError("Transport resume cursor is behind the delivery cursor.");
      }
      if (cursor?.eventId === eventId && cursor.sequence === sequence) return;
      if (cursor?.sequence === sequence) {
        throw new TransportProtocolError("Transport resume cursor conflicts with the delivery cursor.");
      }
      const persisted = (await this.readEvents(sequence - 1, 1))[0];
      if (!persisted || persisted.eventId !== eventId || persisted.sequence !== sequence) {
        throw new TransportProtocolError("Cannot reconcile an event absent from the durable journal.");
      }
      await atomicWriteJson(this.deliveryCursorPath, {
        schemaVersion: 1,
        eventId,
        sequence,
      }, deliveryCursorSchema, { mode: 0o600 });
      for (const verifiedSequence of this.verifiedEvents.keys()) {
        if (verifiedSequence <= sequence) this.verifiedEvents.delete(verifiedSequence);
      }
      const retainAfter = Math.max(0, sequence - this.maxRetainedDeliveredEvents);
      await this.journal.compact((entries) => {
        if (entries.length <= this.maxRetainedDeliveredEvents * 2) return undefined;
        const retained = entries
          .map((entry) => entry.payload)
          .filter((event) => event.sequence > retainAfter);
        return entries.length - retained.length >= this.maxRetainedDeliveredEvents
          ? retained
          : undefined;
      });
    });
  }

  private rememberVerified(event: AppServerEvent) {
    this.verifiedEvents.delete(event.sequence);
    this.verifiedEvents.set(event.sequence, event.eventId);
    while (this.verifiedEvents.size > 4_096) {
      const oldest = this.verifiedEvents.keys().next().value;
      if (oldest === undefined) break;
      this.verifiedEvents.delete(oldest);
    }
  }

  async verifyAndRepair() {
    return this.journal.verifyAndRepair();
  }
}
