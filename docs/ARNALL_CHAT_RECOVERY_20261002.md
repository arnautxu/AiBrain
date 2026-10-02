# Arnall delayed conversation creation — 2026-10-02

## Observed production failure

On revision `9d073e8b89e7734f4300da37ec82e44cc69915b5`, the reported new
conversation with 13 PDF invoices passed permission and document preparation.
`thread/start` timed out after 60 seconds. The gateway subsequently recorded a
successful creation, but the identical response event took another 93 seconds
to reach the client journal, after the extra recovery deadline had expired.
The submission receipt remained `preparing` without a runtime thread identity;
reconnects raised `WorkerTurnRecoveryPendingError` and produced no text.
Private conversation IDs and source document contents are excluded here.

The affected user's three app transport journals occupied about 825 MB.
About 292.8 MB of the 293.4 MB request ledger consisted of completed
`thread-resume` observations. Only roughly 38 KB consisted of thread/turn
creation records. The former journal implementation read and validated the
whole file on ordinary reads and writes, even when only a tail or cursor was
needed. This was a measured backlog, not evidence of failed invoice parsing.

## Correction and safety boundaries

- Validated journal offsets and bounded process-wide snapshots let unchanged
  tail/empty reads and owned appends avoid revalidating historical payloads.
  External mutation, replacement, truncation or compaction invalidates the
  index. Existing locks, corruption checks, fsync and symlink rejection remain.
- Delivered transport history is compacted by bytes as well as count. Every
  unacknowledged event and the delivery cursor anchor remain recoverable.
- The request ledger compacts at gateway startup and after completions. Above
  8 MiB, completed `thread-resume`, `thread-resume-recover` and
  `thread-resume-retry` observations retain at most 4 MiB of response bodies.
  Existing count retention still bounds ordinary completed records. Accepted
  uncertain requests and thread-start, turn-start and server-response receipts
  are never discarded to meet either budget. This is a soft total byte bound:
  pending work and effect evidence take priority over storage reduction.
- A private read-only transport lookup retrieves the exact completed creation
  receipt, checking the original request hash and RPC ID. It never sends a
  replacement request. The runner binds the original thread and confirms it by
  fresh resume before proceeding; a dispatched turn remains fenced.
- Recovery retry budgets reset on actual new progress, not snapshots,
  keepalives or repeated lifecycle states. Exhaustion pauses the visible
  spinner and offers reconnection with the original request and attachments.

See [submission recovery](TURN_SUBMISSION_RECOVERY.md) and
[stream recovery](CHAT_STREAM_RECOVERY.md). Do not delete journals, recreate
message IDs, erase pending receipts or re-upload files as a recovery shortcut.

## Completed results with missing delivery events

A later live recovery confirmed a completed remote turn with final text while
the local conversation still had an empty streaming message. Read-only resume
recovered that same turn and published its answer without another model request.

The runner now observes the exact admitted turn every fifteen seconds, using
fresh paginated reads bound to the original client message and runtime turn IDs.
Observations never overlap, stop on terminal state or runner abort, and retry transport
failures without treating an unavailable observation as model failure. Both the
answer and evidence are projected before publishing completion. Terminal event
snapshots also restore final text if incremental text events were missed.
A final-answer item on an in-progress turn is no longer sufficient to claim
completion. Unconfirmed watchdog interruption keeps the submission recoverable
and does not write a false terminal usage record.

This covers a running server owner losing text and terminal events. Application
restart still uses the existing original-request reattachment path; it does not
authorize reconstructing a different request or creating a replacement turn.
Regression cases cover lost text and terminal events, terminal-only text,
in-progress and foreign-turn observations, non-overlapping retries, and one
model submission with one published completion. Production acceptance remains
separate from these source tests.

## Required release validation

Targeted regressions must cover large historical payloads, cache invalidation,
byte compaction with pending evidence, completed creation lookup after restart,
primary and late deadline expiry followed by reconnect, at-most-once creation
and turn submission, and bounded UI recovery with 13 unchanged attachment IDs.
Run storage/transport/runtime/UI suites, typecheck, lint, contracts, required
release checks and production build before publishing.

Backend CI, GHCR publication, deployment identity, health/readiness and
actual authenticated conversation completion are separate gates. This source
note alone establishes no publication or production acceptance.
