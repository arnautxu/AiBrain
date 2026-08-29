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
| Turn setup | valid chat request → NDJSON response created | p95 ≤ reference + allowance; no repeated access-index or catalog refresh on the hot path | validated locally | `chat.request_phase` separates feature policy, thread context, maintenance, permissions, documents, turn persistence and projection. A project-scoped workbench cache and one resolved authorization context remove repeated parsing and access scans. |
| App Server first delta | server admission immediately before runtime work → first non-empty agent delta accepted | comparative budget | validated locally | Private `codex.turn_metrics.serverFirstDeltaMs` is measured at the server notification boundary. This is not visible TTFT. `src/runtime/turn-telemetry.test.ts` fixes the clock and verifies the calculation. |
| Visible TTFT | send intent → first agent text painted | comparative budget | implemented | `ClientTurnPerformance` records the first non-empty delta after the dispatcher applies it and schedules an rAF. This is a local paint proxy, not a browser-validated visible-latency result; never substitute the server first delta. |
| Streaming cadence | paint timestamps for consecutive non-empty agent deltas | p95 inter-paint gap ≤ reference + allowance; zero reordering/duplicates | implemented | Client readback has bounded inter-paint p50/p95/max after rAF; private `codex.turn_metrics` retains separate server-side cadence. Browser/live comparison remains pending. |
| Total turn latency | send intent → terminal state painted and persisted | comparative budget; persisted terminal state must match UI | implemented | The client records terminal `done`/`error`/`stopped` after rAF; `codex.turn_metrics.totalMs` remains server elapsed. Persisted-state correlation is still a live acceptance requirement. |
| Reconnect latency | disconnect observed → durable snapshot caught up to latest delivered sequence | p95 ≤ 1,000 ms on loopback; comparative live | implemented | Idempotent replay starts a client reconnect span; the next applied durable snapshot is measured after rAF. `codex.turn_lifecycle` remains separate server lifecycle evidence; live catch-up timing is pending. |
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

### Three-second idle causal check

Candidate `689c610b5b70478d9104eb09bbb643bc0b4360e3` was checked with a
controlled clock in `src/runtime/transport/websocket-app-server-transport.test.ts`.
The measured internal timeline is: `t=0` private gateway WebSocket opens,
resumes and is ready; at `t=3000 ms` it has sent no heartbeat (the configured
default is 15 s), has no close code/reason, stays `connected` and has made zero
reconnect attempts. The private worker gateway is loopback
`ws://127.0.0.1:<ephemeral>/app-server` in
`src/runtime/workers/local-gateway-runtime.ts`; it cannot be the public NDJSON
EOF path.

The public browser path is POST NDJSON, not WebSocket. Its incomplete-EOF
recovery belongs to `src/ui/app-server-ui-adapter.ts`: `reader.read()` ending
without `done`, `stopped` or `error` currently returns normally instead of
reattaching the same turn snapshot. Do not reduce the internal 15 s heartbeat
without evidence of an internal loopback close. The runtime transport already
reconnects with exponential backoff+jitter and resumes its durable event cursor;
the UI recovery must reattach to the existing thread/assistant-message IDs
without resubmitting input.

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

The existing server-only operational logger emits bounded JSON records per
correlation, never a public route or client payload. `chat.request_phase`
measures the status-sensitive work that must complete before the NDJSON stream
is returned. `codex.turn_phase` then separates memory, worker startup, catalog,
skills, thread resume/start and `turn/start`. `codex.turn_lifecycle`
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

## Capacity gate for three to four employees

The Compose defaults are a verified configuration limit, not a measurement of
the Hetzner host: `app` is capped at **2 CPU / 4 GiB**
(`infra/hetzner/compose.yaml`). It is therefore insufficient evidence for a
three-to-four-employee claim, particularly when workers, browser tasks or
document conversion overlap.

`npm run test:soak -- --concurrency 4 --cycles 20 --restart-every 5` is the
safe local equivalent: it runs four isolated worker transports, durable replay
and restart/recovery without a customer prompt, provider action or deployment.
The JSON report captures request latency plus process CPU (`userMicros`,
`systemMicros`), process filesystem I/O counters (`fsRead`, `fsWrite`), memory,
journal growth and leaked resources. It does **not** simulate model inference,
real browsers or live Hetzner contention, so it cannot be called production
capacity proof by itself.

| Tier | Host / app limit | Operating envelope | Required evidence before using it |
| --- | --- | --- | --- |
| Current configured default | app: 2 CPU / 4 GiB | Single-user canary or one active worker; not a 3–4 employee commitment | Read back the real host and container limits; no resizing is implied here. |
| Minimum provisional | host: 4 vCPU / 8 GiB; app: 3 CPU / 6 GiB | 3 employees, text-first turns, one browser/conversion burst at a time | Four-worker soak plus a matched live turn sample with p95 CPU below 70% and memory below 75% of the app cap. |
| Recommended | host: 8 vCPU / 16 GiB SSD; app: 6 CPU / 12 GiB | 3–4 employees with overlapping text turns and controlled browser/document work | Same evidence for a sustained window, no queue/backpressure growth and at least 30% CPU/RAM headroom. |

The host readback is strictly diagnostic and must be captured before any
resize: resolve the installation-specific Compose environment, then collect
`docker compose ... config`, `docker stats --no-stream` for `app`, `free -h`,
`df -h`, `iostat -xz 1 3` (when available), and the last 200 `app` log lines.
The operational log slice must include `chat.request_phase`,
`codex.turn_phase`, `codex.turn_lifecycle`, and `codex.turn_metrics`; correlate
only opaque IDs and numeric timings. Record the immutable revision, limits,
sample period and raw counters with the report. Never treat a healthy endpoint,
an empty log, or this local fixture as host-capacity acceptance.

## Client paint telemetry readback

Baseline: candidate `fcb30b15a28f037d70a0eec4141b914e67e7182b` has no
client-side send-to-rAF timing, client paint cadence, terminal paint or
reconnect-to-snapshot measurement. Runtime's private telemetry cannot observe
those client scheduling points.

`src/ui/client-turn-performance.ts` holds at most 24 per-turn readbacks in the
authenticated client's memory. A readback has only numeric durations/counts and
a terminal enum: no prompt, response text, tokens, identifiers, filenames,
error detail or secret. It is surfaced in that user's Review panel and may be
downloaded only by that user action. This change adds no API route, analytics
POST, shared storage or server logger.

The event dispatcher calls the measurement only after it has applied a frame,
then the measurement schedules rAF. The resulting timestamp is a controlled
local proxy for a paint opportunity, not proof that a real browser painted it;
real-browser and Arnall validation remain required before claiming visible TTFT
or user-perceived streaming latency.

## Historical live observations, not current acceptance

Repository evidence records first-text/total pairs of 3003/4891 ms,
2021/3513 ms and 2250/3774 ms for one earlier deployed revision, and a later
Computer Use turn at 15219/22741 ms. These numbers demonstrate large prompt/tool
variance; they do not prove the current branch, current production revision or
ChatGPT Work parity. Repeat the matched benchmark after release and attach the
immutable revision, model, prompt, timestamps, raw NDJSON event timing and final
persisted turn/usage readback.

## Warm-path implementation

Opening a project verifies the private worker account and starts a non-blocking,
project-scoped catalog preload. Catalog data is fresh for five minutes; for the
next 25 minutes a turn uses the last verified value immediately while a single
deduplicated refresh runs in the background. A cold or older-than-30-minute
catalog still fails closed by awaiting a verified refresh.

Filesystem workbench state is cached only after strict schema validation and is
invalidated by inode, mtime or size changes. Cached entries are cloned before
use, limited to 16 MiB each and 128 MiB process-wide. The durable file lock,
atomic write, tenant/user binding and projection overlay remain authoritative.
Unchanged shared-access fingerprints no longer rewrite the access index or add
a redundant audit entry; actual membership, role or project changes still
invalidate the fingerprint and update the index synchronously.
