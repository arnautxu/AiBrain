# Bounded conversation recovery

## Incident evidence, 2026-10-01

The Arnall employee conversation failed twice while resuming its existing
runtime thread. Authentication succeeded, `thread/resume` timed out after
60 seconds, and the fallback `thread/read` closed the worker transport.
An isolated snapshot reproduced a full-history `thread/read` response of
9,727,340 bytes. The gateway's stdout and WebSocket response limits are
8 MiB. A metadata-only read returned 1,102 bytes. No customer history was
edited during diagnosis; database backups and the rollout copy were confined
to a temporary directory removed after the isolated process exited.

## Recovery contract

Resume requests exclude full-history hydration and bootstrap one full turn.
Durable fallback reads request metadata only. Both paths traverse descending
one-turn pages until the exact admitted `clientUserMessageId` is found or
the history ends. Only that matching turn is projected. The original thread
identity, permissions and configuration remain bound to the authenticated
employee; a mismatched thread is rejected before any pagination or projection.

The existing 8 MiB transport limits remain intact. Pagination is bounded by
the original request deadline, 256 pages, and advancing opaque cursors.
An individual turn that exceeds the transport limit still fails closed; this
change does not authorize unbounded frames. Model actions, document effects
and tool calls are never retried by the reader. A matched durable turn retains
its terminal state, so recovery does not submit a duplicate model turn.

## Release and acceptance

Run the paged recovery, worker-turn, gateway and WebSocket transport tests,
typecheck, lint and production build. Then verify Backend CI, GHCR publication,
deployment identity and authenticated conversation acceptance separately for
the candidate SHA. Health alone does not prove the affected conversation can
resume. The live acceptance must use its existing thread and preserve all
messages and attachments; do not replace or truncate its rollout or clear
the customer's durable runtime journals as a workaround.
