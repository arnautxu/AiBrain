# Model capacity admission recovery

## Incident: 2026-10-05

The deployed `82ca155a80ad5a7f1226d67f3c4479ac5d3ccf38` recorded two Smart
turns on `gpt-5.6-sol` and one Expert turn on `gpt-6-astra` failing before any
text or tool activity. The private transport journal confirmed terminal
`failed` and `codexErrorInfo: serverOverloaded`. Healthy containers did not
prove provider availability. No customer document contents are in this note.

## Recovery contract

The server allows at most two automatic retries, after 5 and 15 seconds, using
the same selected model and effort. A terminal provider notification alone is
insufficient: a fresh actor-bound full-turn read must contain only the matching
user input, terminal `failed`, the exact runtime turn ID and the structured
`serverOverloaded` code. Any observed item activity beyond the user input or
any server request blocks automatic replay. Partial text, reasoning, commands,
tools, approvals, artifacts, plan and diff never qualify. Transport uncertainty,
usage limits, unsupported models and authentication failures never qualify.

Each retry consumes its durable budget and persists a fresh client input ID
before a new write-ahead `turn/start` intent. RPC keys include the attempt
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
Only automatically retried turns write schema 2. Both are read without reopening
dispatched or terminal fences. Schema 2 stores the consumed retry count, latest dispatched client
identity, next retry client identity and previous rejected runtime ID. The
immutable document originals and public conversation schema are unchanged.
An older binary cannot parse schema-2 submissions: rollback may leave recovery
of those individual submissions unavailable. Preserve receipts and history;
never downgrade them or clear journals to make an old reader accept them. A
code rollback that must retain recovery should keep the schema-2 reader.

Local acceptance covers recovered capacity, persistent capacity, partial work,
wrong error codes, partial authoritative readback, lost readback, cancellation,
budget retention after restart, legacy fences and guarded projection rotation.
Backend CI, immutable GHCR publication, deployment/host revision readback and
authenticated model turns are separate release gates. A successful real turn
does not prove that a historical invoice review completed; validate that review
on its original conversation or obtain the employee's confirmation separately.
