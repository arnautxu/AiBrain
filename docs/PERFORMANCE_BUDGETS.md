# Runtime and performance budgets

This document is the acceptance ledger for turn lifecycle, streaming and
perceived performance. A green port or `/api/health/ready` response is not an
AI health result. Live validation requires an authenticated turn through Codex
App Server, its streamed events, durable projection and final persisted state.

Statuses are `not started`, `implemented`, `validated locally` and
`validated live`. A row may only advance when the linked evidence measures the
same definition.

## Lifecycle contract

| Capability | State | Contract and evidence |
| --- | --- | --- |
| Stable turn identity and replay | validated locally | UI IDs are idempotency keys; App Server IDs are bound server-side. `src/runtime/worker-codex-turn.ts`, `src/runtime/transport/app-server-rpc-router.ts`, `tests/integration/worker-crash-recovery.integration.test.ts`. |
| Two users / four concurrent threads | validated locally | Routing is installation + user worker + runtime thread + runtime turn. `tests/integration/multi-user-worker-acceptance.integration.test.ts`. |
| Reconnect without cross-turn projection | validated locally | Journal replay and the turn owner captured at event receipt prevent a delayed event from attaching to a later registration. `src/runtime/transport/file-event-journal.ts`, `src/runtime/transport/app-server-rpc-router.test.ts`, `src/workbench/turn-projection-store.test.ts`. |
| NDJSON disconnect does not stop the turn | validated locally | The HTTP consumer is now separate from the server-owned turn lifetime. Only `/api/runtime/turns/control` can request `turn/interrupt`. `src/app/api/chat/route.ts`, `src/app/api/chat/route.test.ts`. Live refresh/reconnect remains pending. |
| Explicit stop is durable and scoped | validated locally | Stop resolves the private runtime IDs from the turn projection and requires the expected turn. `src/runtime/turn-control.ts`, `tests/integration/turn-control-route.integration.test.ts`. |
| Per-turn token attribution | validated locally | Only the `last` breakdown from `thread/tokenUsage/updated` is accepted when thread and turn match. Account-wide usage remains a shared subscription snapshot and is never assigned to an employee. `src/runtime/worker-codex-turn.ts`, `src/usage/server-service.ts`, `src/usage/file-usage-store.test.ts`. |
| Real restart recovery on Arnall | not started | Requires an authenticated turn, restart of the deployed immutable revision, reconnect with the same local IDs, one final message and one usage record. Health endpoints alone do not satisfy this row. |
| Browser/tool exactly-once outcome | not started | A durable call record does not prove a remote side effect did not occur before a target/session error. Recovery must expose `indeterminate` and must not replay non-idempotent `open`, `click` or `type` operations. Browser owner tests by failure phase are required. |

## Metric definitions and budgets

Remote/model-dependent budgets are comparative: measure AiBrain and ChatGPT
Work on the same Mac, network, account/model and prompt set. AiBrain passes when
its p50 and p95 are no worse than the reference by more than 10% or 250 ms,
whichever allowance is larger. This avoids promising a fixed model time without
a controlled benchmark.

| Metric | Start / end | Guardrail | State | Current evidence / next measurement |
| --- | --- | --- | --- | --- |
| Input latency | key/paste event → next painted composer value | p95 ≤ 100 ms; no task > 200 ms | not started | Browser `performance.mark` and `requestAnimationFrame`; UI owner. |
| Navigation latency | navigation intent → destination shell painted and interactive | p95 ≤ 500 ms for cached shell; otherwise comparative budget | not started | Browser marks per sidebar/search/project/thread transition; UI owner. |
| TTI | document navigation start → composer focused and usable | comparative budget | not started | Must be collected in the real Arnall browser, not inferred from server logs. |
| App Server first delta | server admission immediately before runtime work → first non-empty agent delta accepted | comparative budget | validated locally | Private `codex.turn_metrics.serverFirstDeltaMs` is measured at the server notification boundary. This is not visible TTFT. `src/runtime/turn-telemetry.test.ts` fixes the clock and verifies the calculation. |
| Visible TTFT | send intent → first agent text painted | comparative budget | not started | Requires a client send mark and a post-paint mark for the first `delta`. Never substitute first server delta. |
| Streaming cadence | paint timestamps for consecutive non-empty agent deltas | p95 inter-paint gap ≤ reference + allowance; zero reordering/duplicates | implemented | Private `codex.turn_metrics` includes server-side delta count plus inter-delta p50/p95/max. Client paint cadence is still pending. |
| Total turn latency | send intent → terminal state painted and persisted | comparative budget; persisted terminal state must match UI | implemented | `codex.turn_metrics.totalMs` is server runtime elapsed; the durable usage record retains request total. Client paint/persistence correlation is pending. |
| Reconnect latency | disconnect observed → durable snapshot caught up to latest delivered sequence | p95 ≤ 1,000 ms on loopback; comparative live | implemented | `codex.turn_lifecycle` correlates `disconnected`, `reconnected` and `resumed` without payloads. It is event evidence, not yet the end-to-end client catch-up latency. |
| Tool latency | App Server item start → terminal tool outcome, split into queue/runtime/projection/paint | overhead p95 ≤ 250 ms excluding remote tool execution | not started | Browser owner must also preserve `indeterminate`; runtime must log the phase timestamps without command/body/secrets. |

## Reproducible local evidence on the authorized base

Historical lifecycle baseline: `d381ccf836516f91464f20225403996e7e8158d1`.

Telemetry P0 candidate base: `f2c48dc9d84c8876bfd0432f4f09f1b648d59da0`.
Before this candidate extension, `codex.turn_metrics` emitted only
`firstTextMs` and `totalMs` when a turn completed; it had no cadence summary,
terminal state or stream lifecycle record. The private fields described below
are the server-side replacement, not a visible TTFT measurement.

Focused lifecycle slice:

```text
vitest run
  tests/integration/multi-user-worker-acceptance.integration.test.ts
  tests/integration/worker-crash-recovery.integration.test.ts
  src/runtime/transport/app-server-rpc-router.test.ts
  src/runtime/transport/websocket-app-server-transport.test.ts
  src/workbench/turn-projection-store.test.ts
  src/usage/file-usage-store.test.ts
  src/runtime/worker-codex-turn.test.ts

7 files passed, 32 tests passed, 16.39 s
```

Disconnect regression:

```text
vitest run src/app/api/chat/route.test.ts
1 file passed, 1 test passed
```

Telemetry focal regression on the candidate extension:

```text
npx vitest run
  src/runtime/turn-telemetry.test.ts
  src/runtime/worker-codex-turn.test.ts
  src/app/api/chat/route.test.ts

3 files passed, 6 tests passed, 1.43 s
```

The post-change TypeScript check, targeted ESLint check and contract verification
passed. A combined post-change lifecycle run completed 36 assertions in eight
files, while the two timing-heavy integration files hit their fixed 25 s and
20 s ceilings. Individual reruns hit the same ceilings while other AiBrain
worktrees were compiling and running Vitest concurrently. These reruns are
recorded as inconclusive environmental evidence, not as passes; repeat them on
a quiet runner before integration. The green baseline above was collected
before this route-only change from the same authorized commit.

Generated Codex contract verification also passed for pinned version `0.149.1`.
The desktop Codex binary inspected on the development Mac reports
`0.149.0-alpha.4.3`; that process is not the Arnall worker and is not accepted as
live AiBrain evidence. Production's entrypoint must continue rejecting a binary
that differs from the generated contract version.

## Private runtime telemetry readback

The existing server-only operational logger emits two bounded JSON records per
correlation, never a public route or client payload. `codex.turn_lifecycle`
records `resumed`, `reconnected`, `disconnected` and `cancel_requested` with
opaque installation/user/project/thread/turn/request IDs and request elapsed
time. `codex.turn_metrics` records terminal `completed`, `error` or `stopped`,
server first-delta time, delta count, inter-delta p50/p95/max, server total and
lifecycle counts. It deliberately excludes prompt/message/content fields,
model output, token data, error text, file paths and credentials.

Operators read these records only from the existing authenticated operational
log sink or an approved server-side acceptance artifact. A visible TTFT or
paint cadence must continue to come from the client benchmark, not these server
records.

## Historical live observations, not current acceptance

Repository evidence records first-text/total pairs of 3003/4891 ms,
2021/3513 ms and 2250/3774 ms for one earlier deployed revision, and a later
Computer Use turn at 15219/22741 ms. These numbers demonstrate large prompt/tool
variance; they do not prove the current branch, current production revision or
ChatGPT Work parity. Repeat the matched benchmark after release and attach the
immutable revision, model, prompt, timestamps, raw NDJSON event timing and final
persisted turn/usage readback.
