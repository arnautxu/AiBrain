# Model capacity admission recovery

## Incident: 2026-10-05

The deployed `82ca155a80ad5a7f1226d67f3c4479ac5d3ccf38` recorded two Smart
turns on `gpt-5.6-sol` and one Expert turn on `gpt-6-astra` failing before any
text or tool activity. The private transport journal confirmed terminal
`failed` and `codexErrorInfo: serverOverloaded`. Healthy containers did not
prove provider availability. No customer document contents are in this note.

## Recovery contract

The server allows at most two automatic retries, after 5 and 15 seconds. It
prefers a compatible alternative from the fresh authenticated model catalog:
Expert (`gpt-6-astra`) tries `gpt-5.6-sol`, then `gpt-5.6-terra`; Smart
(`gpt-5.6-sol`) tries `gpt-6-astra`, then `gpt-5.6-terra`; Fast
(`gpt-5.6-terra`) tries `gpt-5.6-sol`, then `gpt-6-astra`. The current model is
excluded from alternative selection. Effort is retained when supported,
otherwise the catalog's supported default is used. Image inputs require image
support. Image-generation requests and unknown model families do not switch;
an unavailable catalog or no compatible alternative retains the current model.
The user sees that an alternative will be used. A terminal notification alone is
insufficient: a fresh actor-bound full-turn read must contain only the matching
user input, terminal `failed`, the exact runtime turn ID and the structured
`serverOverloaded` code. Any observed item activity beyond the user input or
any server request blocks automatic replay. Partial text, reasoning, commands,
tools, approvals, artifacts, plan and diff never qualify. Transport uncertainty,
usage limits, unsupported models and authentication failures never qualify.

Each retry consumes its durable budget and persists a fresh client input ID
and selected model/effort before a new write-ahead `turn/start` intent. A retry
dispatch must match that persisted choice. RPC keys include the attempt
number. Restart and reconnect recover the exact attempt; they never reset the
budget or replay a dispatched request. A crash before a retry is authorized
leaves the failed original recoverable. The two rejected provider admissions
remain in native history; the product has one user message and one assistant
answer. Permission, identity, workspace and document checks run on each retry.
Private originals are retained; unpublished working copies are rebuilt only
after confirming an empty rejection.

The runtime projection permits ID rotation only when the server supplies the
exact rejected previous ID and the local answer is still active with no
content, plan, approvals, diff, sources, artifacts or tool results. Provider
registration is disposed between attempts. Stop during backoff cancels retries.
Persistent saturation returns a localized explanation and preserves history
and attachments. Model availability remains controlled by the provider.

## Receipt compatibility and release

Ordinary turns continue writing schema 1, preserving rollback compatibility.
Only automatically retried turns write schema 3; schemas 1 and 2 are read
without reopening dispatched or terminal fences. Schema 3 stores the retry
model/effort, consumed retry count, latest dispatched client
identity, next retry client identity and previous rejected runtime ID. The
immutable document originals and public conversation schema are unchanged.
An older binary cannot parse schema-3 submissions: rollback may leave recovery
of those individual submissions unavailable. Preserve receipts and history;
never downgrade them or clear journals to make an old reader accept them. A
code rollback that must retain recovery should keep the schema-3 reader.

## Installation queue and retained connection

On 2026-10-05 the operator explicitly chose to retain the current connection.
This change does not migrate credentials, enable API billing, or alter weekly
token limits. Queue admission limits local logical work, not the provider's
capacity or the account's total traffic from other installations or clients.

The app and scheduled turns share `dataRoot/runtime/model-turn-queue/`, an
app-owned private filesystem queue. Defaults are two admitted turns, fifty
waiting turns and five minutes maximum wait. The optional environment settings
are `AIBRAIN_MODEL_MAX_CONCURRENT` (1–32), `AIBRAIN_MODEL_MAX_WAITING` (1–200)
and `AIBRAIN_MODEL_QUEUE_WAIT_MS` (1–3600000). All processes using an installation
must use the same settings and data root. Admission precedes thread/model
dispatch; order is FIFO and the waiting activity supports the existing Stop
control. Retries release and reacquire admission. Entries contain only hashed
identity, owner, state and heartbeat time, never prompts or documents.

An atomic state update under a cross-process lock owns each admission. Waiting
entries left by a crashed runner expire after thirty seconds. Running entries
never expire automatically: a transport failure can leave real remote work.
Reconnecting that exact durable turn adopts its admission even at capacity,
reads its authoritative state and releases only on confirmed terminal state,
confirmed interruption, or proof that no model submission was dispatched.
Legacy turns already in progress may temporarily exceed the limit while being
reconciled; new submissions still wait. Stop during recovery uses remote
interruption, never just removal from the queue.

After a crash, reopen/reconnect the affected conversation to reconcile it.
Do not clear running queue tickets based on age or healthy containers. A code
rollback to a version without this queue disables the concurrency bound; keep
the queue state for reconciliation when returning to a queue-aware version.

Local acceptance covers recovered capacity, persistent capacity, partial work,
wrong error codes, partial authoritative readback, lost readback, cancellation,
budget retention after restart, legacy fences and guarded projection rotation.
Backend CI, immutable GHCR publication, deployment/host revision readback and
authenticated model turns are separate release gates. A successful real turn
does not prove that a historical invoice review completed; validate that review
on its original conversation or obtain the employee's confirmation separately.
