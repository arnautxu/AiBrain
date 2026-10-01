# Durable submission and attachment recovery

## Reproduced failure

An admitted `turn/start:<assistantMessageId>` kept its idempotency key but rebuilt
Excel copies in a new random directory on reconnect. This changed the payload
and could trigger `clientRequestId was reused with a different payload`.
Unconditional cleanup also deleted editable copies when the remote outcome was
unknown. Synthetic one-file and twenty-file cases reproduce this mechanism;
they do not establish the cause of a particular customer error.

## Ownership and dispatch

The app keeps a private receipt at
`<userRoot>/state/turn-submissions/<threadId>/<assistantMessageId>.json`.
The existing worker sandbox does not mount this state directory. Directories
are 0700 and files 0600; reads are bounded and symlinks rejected. An existing
ResourceLockManager lease covers the runner, including its normal 30-second
stale-lease and dead-owner checks after process death.

Each receipt binds installation, user, project, thread, both message identities,
authorized request, permission fingerprint and immutable source metadata.
Preparation records its private directory before copying and stores the exact
manifest. An interrupted, unpublished preparation can be rebuilt. Prepared
inputs are reused, never reconverted. Editable copies are not compared with the
original hash; private regular-file paths and size limits are revalidated.
Original staged uploads remain unchanged.

The exact initial thread/start and turn/start requests are written durably before
dispatch. A recorded intent prevents another model submission even after gateway
receipt expiry. An uncertain write acknowledgement also fences the current
runner. A missing remote turn is not proof of failed submission.

Warm and cold reconnects use bounded paged reads of the exact admitted user
message. Each observation has a fresh correlation key to avoid obsolete cached
reads; effect request keys remain unchanged. Existing admissions predating the
receipt are recovery-only. A receiptless observer does not persist its fence
until it finds the matching remote turn, so an early reconnect cannot prevent
the original runner from starting.

## Completion and limits

Only a matching remote terminal event or durable terminal read permits cleanup.
An interrupt RPC acknowledgement, local UI completion heuristic, transport
failure or timeout is insufficient. Unknown turns retain their working copies.
On confirmed completion the payload and manifest are scrubbed; a compact terminal
identity remains to prevent late replay. No age-based deletion is added.

A crash between durable intent and transmission can remain pending until remote
evidence resolves it. A lost thread-creation acknowledgement without a recovered
thread id also remains pending. This change cannot restore files already deleted
by an older version. Local completion heuristics can leave a nonterminal receipt
retained for later reconciliation; do not delete it to force another model turn.

This fix changes no upload allowlist, active-content rejection, file-count limit,
transport frame limit, permission policy or document-publishing control.

## Verification and release gates

Run submission-store, worker-turn, chat-route, automation and transport tests,
typecheck, lint, contract verification and production build. The authenticated
HTTP recovery E2E uses 1 and 20 fictional XLSX files with the real app/transport.
Identity-provider, preview-tool and worker boundaries are synthetic. It makes
no model calls and is not a LibreOffice fidelity test or customer acceptance.

Backend CI, image publication, deployment identity and authenticated acceptance
on the affected existing conversation remain separate gates. Preserve history
and attachments; never clear journals or change message ids to force a retry.
See [bounded conversation recovery](PAGED_THREAD_RECOVERY.md).
