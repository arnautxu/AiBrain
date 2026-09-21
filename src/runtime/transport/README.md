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

### Thread creation and late responses

Thread creation uses the admitted local turn ID as its stable request key.
Retries of that turn retain the same key; a subsequent user turn or toolset
bootstrap does not reuse an older creation request. After the initial 60-second
deadline, the chat waits up to 120 seconds for that request's original response
without submitting another `thread/start` or model turn. Duplicate pending
requests remain rejected by the router. If the deadline expires during the
durable response projection, completing that projection also resolves the
original late-response promise and clears its timeout receipt.

On 2026-09-21, production revision `7f89f20` recorded a creation timeout at
11:58:40 UTC, followed by two attempts with the same conversation-wide creation
key. The original response reached the journal at 12:00:31 UTC. A concurrent
horarIA calculation produced more than 1,300 streamed deltas, with the original
tool event still undelivered. This evidence motivates bounded late-response
recovery; it does not establish that journal throughput or cancellation of a
nested calculation is fixed. The new recovery and request-key behavior require
separate CI, publication, deployment and authenticated acceptance.

Local regression coverage includes recovery of a late creation without a
second submission, distinct creation keys for subsequent turns, projection
completion after the primary deadline, and 1,400 calculation deltas while the
parent tool is blocked. The 138 targeted runtime, transport, permission,
multi-user, restart and release tests passed, along with type checking, scoped
lint, generated-contract validation, infrastructure checks and the worker build.

Client submissions are acknowledged only after the gateway has durably
accepted their idempotency key and written them to App Server stdin. JSON-RPC
responses to server-initiated requests are stricter: their
`clientRequestId` is deterministically derived from the durable request event
and a SHA-256 fingerprint of its thread/turn scope,
and the gateway does not send `accepted` until App Server emits a later event
for the same thread and turn. If the process dies in that window, the response
stays uncertain and is replayed with the same identifier after worker restart.
This avoids acknowledging an approval response merely because it reached an
operating-system pipe.

The JSON-RPC payload types and runtime validators come from the generated Codex
`0.153.4` bindings and JSON Schemas in `contracts/codex/0.153.4`. Unknown
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

## Node WebSocket composition

Node's browser-compatible global `WebSocket` API does not expose a supported
way to add an `Authorization` header. `StandardWebSocketFactory` therefore
supports only the explicit subprotocol mode. The server-side composition uses
the pinned `ws` dependency through `NodeWebSocketFactory`, which supports the
private gateway's bearer header. Next keeps `ws` in `serverExternalPackages`;
bundling it into an API-route chunk can substitute framework WebSocket code and
prevent the loopback client from connecting even though the gateway listener
is healthy.

Codex App Server `0.153.4` marks its WebSocket listener experimental and
unsupported for production. The raw listener also does not provide AiBrain's
durable `eventId` replay or `clientRequestId` acceptance contract. Those
guarantees belong to the private worker gateway envelope implemented here;
they must not be simulated by reconnecting directly to a raw App Server and
silently resending accepted requests.
