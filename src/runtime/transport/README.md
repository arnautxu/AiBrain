# App Server transport boundary

`AppServerTransport` keeps runtime routing independent from one Codex transport.
The first implementation, `WebSocketAppServerTransport`, connects the AiBrain
backend to the private per-user worker gateway. The gateway owns the raw Codex
App Server connection and adds the small versioned envelope required for
durable acceptance, heartbeat, event ids, acknowledgements and replay.
The transport has no implicit in-memory replay fallback: composition must
provide a `TransportEventJournal`, and production must use a durable adapter.
`FileTransportEventJournal` is the local filesystem adapter. It stores a
versioned JSONL record, verifies contiguous worker sequences, rejects event-id
reuse and restores the replay cursor after a backend restart.
Delivered history is compacted atomically to a bounded tail (256 events by
default) while every undelivered event remains durable. Payload sequence and
the delivery cursor stay authoritative across compaction and restart; the
internal JSONL sequence is intentionally regenerable.

The JSON-RPC payload types and runtime validators come from the generated Codex
`0.149.1` bindings and JSON Schemas in `contracts/codex/0.149.1`. Unknown
envelope fields, unknown methods, malformed or method-incompatible params,
non-JSON payloads, sequence gaps and binary WebSocket frames fail closed.

## Authentication and network boundary

- Credentials are supplied lazily by `WebSocketCredentialProvider` and are
  never accepted in the URL.
- Raw Codex App Server authentication uses `Authorization: Bearer <token>`.
  A subprotocol credential is available only for an AiBrain worker gateway that
  explicitly implements `aibrain.auth.*`; it is not presented as a raw Codex
  protocol feature.
- The endpoint must resolve entirely to loopback or RFC1918/ULA addresses.
  Docker service names require an explicit hostname allowlist. `ws://` outside
  loopback additionally requires an explicit private-plaintext opt-in; use
  `wss://` whenever the connection crosses hosts.

## Node WebSocket limitation

Node's browser-compatible global `WebSocket` API does not expose a supported
way to add an `Authorization` header. `StandardWebSocketFactory` therefore
supports only the explicit subprotocol mode. A production composition that
connects directly to Codex App Server must inject a server-side
`WebSocketFactory` backed by a client that supports handshake headers. This
repository does not add such a dependency in this checkpoint.

Codex App Server `0.149.1` marks its WebSocket listener experimental and
unsupported for production. The raw listener also does not provide AiBrain's
durable `eventId` replay or `clientRequestId` acceptance contract. Those
guarantees belong to the private worker gateway envelope implemented here;
they must not be simulated by reconnecting directly to a raw App Server and
silently resending accepted requests.
