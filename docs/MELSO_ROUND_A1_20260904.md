# A1 — worker admission and owned-process recovery

Status: implemented and validated locally; no push, deploy, provider invocation,
customer data, goals, automation, or subagents. Base and fresh pre-commit
`origin/main`: `048a7d4cef7752fe716f66e84e5c52f7ec663022` (unchanged).

## Three bounded corrections

1. Coalesce per-user client startup/initialization recovery, not turn execution.
   Concurrent chats now share one failed initialization and one retry; a failed
   retry closes its client and worker. Cleanup failure prevents replacement.
2. The production POSIX launcher owns a detached process group. Shutdown sends
   TERM, allows 1 second, then KILL and checks disappearance for up to 5 seconds.
   Surviving descendants are handled even after their leader exits. Concurrent
   stops join the same cleanup. Gateway sockets terminate without waiting for a
   client close handshake. Injected factories never implicitly own a PID group.
3. Registry cleanup only touches a runtime after exclusive ownership succeeds.
   A reused factory object cannot stop another employee. Failed cleanup retains
   the runtime and fences subsequent starts until an explicit cleanup succeeds;
   the managed gateway likewise retains its cleanup handle on failure.

Already fixed at baseline, retained and regression-tested: plain-text admission
does not await the optional five-RPC catalog; model selection comes from request
options/server runtime configuration and is validated by App Server. Independent
RPC/event lanes admit another same-user chat during slow work. No keyword
responses, model lookup on the web, or replacement journal/lease system added.

## Read-only source mechanisms

Melso inspected at `7c667dd1a41fee4bc2b5172649527cf9f4d26771`, after its root
AGENTS/CLAUDE instructions. No license evidence permitting literal reuse was
provided; this is independently written TypeScript, not copied Go code.

- `server/internal/daemon/daemon.go`: `contextLock` (308–338) scopes waiting;
  claim dispatch/release (4870–4915) retains ownership until work and cleanup end.
  AiBrain keeps its existing per-user registry and maintenance leases.
- `server/internal/daemon/processtree/run.go` and `controller_unix.go`: bounded
  TERM/KILL escalation and residual group cleanup after the leader exits.
- `server/pkg/agent/codex.go` (1020–1045): wrapper/native descendant ownership;
  cancellation must not only terminate the immediate child.

Read AiBrain operating truth, north star, release/acceptance runbook, performance
budgets, worker/transport READMEs, and installed Next `serverExternalPackages`
guide. The pinned local App Server contract remains 0.149.1 with no RPC changes.

## Verification

Final run: **7 files, 82 tests passed, 36.28 s**, one worker, no file parallelism:

```text
vitest run
  src/runtime/worker-runtime-service.test.ts
  src/runtime/workers/owned-process.test.ts
  src/runtime/workers/workers.test.ts
  src/runtime/workers/local-gateway-runtime.test.ts
  src/runtime/transport/app-server-rpc-router.test.ts
  src/runtime/turn-telemetry.test.ts
  src/runtime/worker-codex-turn.test.ts
  --maxWorkers=1 --no-file-parallelism --cache=false --silent
```

The run used a temporary config spreading `vitest.config.mts` and overriding
`cacheDir` to `/tmp/aibrain-a1-20260904-vite-cache`; dependencies were linked
read-only from the existing AiBrain installation, with no package installation.
The first two-file iteration had two fixture failures because an immediate
mock rejection completed before concurrent filesystem-backed admission reached
the shared operation. A deferred failure now explicitly overlaps all callers.
Subsequent focal runs passed (66 and 48 tests), then the final 82-test run passed.

New regressions cover three overlapping init callers (success/failure retry),
blocked model metadata with another request admitted before release, stubborn
descendants, normally exited leaders, an unaffected second process group,
cross-user factory reuse, and startup/stop cleanup failure fencing. Existing
tests cover fourth-chat admission while a tool is blocked, scoped timeout/stop,
no duplicate model action/final, and payload-free phase/queue/first-event metrics.
Targeted ESLint and `git diff --check` passed. No full build, full suite, E2E,
whole-repository typecheck, or live latency/capacity claim.

## Handoff boundaries

No B/UI/worker-codex-turn contract changes. Only internal service state gains a
per-user admission map; custom tests injecting that state must supply it.
POSIX process-group fixtures passed on macOS. Linux/container acceptance remains
unverified; Windows retains direct-child behavior. Descendants deliberately
escaping the owned group require OS containment, not this helper. The bounded
process stop does not impose a deadline on existing durable filesystem drains.
Existing initialization/authentication and required policy/context checks remain
necessary; this does not promise provider first-token speed. No integration
blocker found; F must preserve the common baseline and recheck remote main.
