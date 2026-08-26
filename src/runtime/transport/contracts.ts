import type { ClientNotification } from "../../../contracts/codex/0.149.1/types/ClientNotification";
import type { ClientRequest } from "../../../contracts/codex/0.149.1/types/ClientRequest";
import type { RequestId } from "../../../contracts/codex/0.149.1/types/RequestId";
import type { ServerNotification } from "../../../contracts/codex/0.149.1/types/ServerNotification";
import type { ServerRequest } from "../../../contracts/codex/0.149.1/types/ServerRequest";

export const APP_SERVER_TRANSPORT_PROTOCOL_VERSION = 1 as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonRpcSuccess = {
  id: RequestId;
  result: JsonValue;
};

export type JsonRpcFailure = {
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
};

/**
 * A logical, idempotent submission to the worker gateway. `clientRequestId`
 * identifies the submission across reconnects; it is deliberately separate
 * from a JSON-RPC response id because replies to server-initiated requests
 * reuse the server's id.
 */
export type AppServerRequest =
  | {
      clientRequestId: string;
      kind: "rpc-request";
      rpc: ClientRequest;
    }
  | {
      clientRequestId: string;
      kind: "rpc-notification";
      rpc: ClientNotification;
    }
  | {
      clientRequestId: string;
      kind: "rpc-response";
      rpc: JsonRpcSuccess | JsonRpcFailure;
    };

export type AppServerRpcEvent =
  | { kind: "rpc-response"; rpc: JsonRpcSuccess | JsonRpcFailure }
  | { kind: "rpc-notification"; rpc: ServerNotification }
  | { kind: "rpc-request"; rpc: ServerRequest };

export type AppServerEvent = {
  eventId: string;
  sequence: number;
  occurredAt: string;
  message: AppServerRpcEvent;
};

export type ReplayCursor = {
  eventId: string;
  sequence: number;
};

export type TransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closing"
  | "closed";

export type TransportHealth = {
  healthy: boolean;
  state: TransportState;
  endpoint: string;
  reconnectAttempt: number;
  pendingRequests: number;
  lastEventId: string | null;
  lastEventSequence: number | null;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
};

export interface AppServerTransport {
  connect(): Promise<void>;
  send(message: AppServerRequest): Promise<void>;
  events(): AsyncIterable<AppServerEvent>;
  health(): Promise<TransportHealth>;
  close(): Promise<void>;
}

export interface TransportEventJournal {
  loadCursor(): Promise<ReplayCursor | null>;
  /** Must durably append before resolving. Duplicate event ids return false. */
  append(event: AppServerEvent): Promise<boolean>;
}

export class InMemoryTransportEventJournal implements TransportEventJournal {
  private cursor: ReplayCursor | null = null;
  private readonly eventIds = new Set<string>();

  async loadCursor() {
    return this.cursor ? { ...this.cursor } : null;
  }

  async append(event: AppServerEvent) {
    if (this.eventIds.has(event.eventId)) return false;
    this.eventIds.add(event.eventId);
    this.cursor = { eventId: event.eventId, sequence: event.sequence };
    return true;
  }
}
