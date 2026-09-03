# F — integrated local candidate, 2026-09-04

## Identity and scope

Candidate is the commit containing this note; obtain its full SHA with
`git rev-parse HEAD` in `/Users/davidliria/Documents/AiBrain-melso-f-20260904`,
branch `codex/arnall-melso-f-20260904`. It is not merged into main, pushed,
published or deployed. Baseline: `048a7d4cef7752fe716f66e84e5c52f7ec663022`.
The initial fetch confirmed that same origin/main. Cherry-picks with provenance:

- A1 `63a7d0e6ec135f45cf719e203571541ed40693d1` → `7c97682`.
- B `5a86b4720fdb1147a4a1aa36b10c69e90fe80a68` → `d40873f`.
- C `a46216bc9e6d30d0b710e1090aec256fcd7480c2` → `803fefe`.

No conflicts. A1 retains per-user single-flight admission/recovery and owned
POSIX process-group cleanup fencing. B applies the entire first chunk, then
full next-rAF batches or a 48 ms fallback with exact flush. C serializes bounded
attachment-owned input, renews scoped tokens conservatively and never replays
uncertain mutations. Existing server authorization, phases, per-chat sending,
automatic memory and Arnau spreadsheet persistence remain unchanged.
Worker notes document independent adaptations and read-only Melso references;
F copied no Melso source and assumed no reuse license.

F corrected only a demonstrated integration fixture defect: B's new ToolResult
omitted required `output`, causing TS2741. An empty fixture output restores the
existing contract, without changing production behavior. Search found no stale
imports of B's removed constants. The admission fixture supplies
`clientAdmissions`; the older deliberately partial cancellation-only fixture
does not execute admission. Browser input still validates same origin, session,
owned thread and control-token binding on the server. PERFORMANCE_BUDGETS now
describes current batching; old measurements remain explicitly historical.

## Reproducible environment

Node `v24.4.1`, npm `11.4.2`; complete locked install:
`npm ci --cache /tmp/aibrain-f-npm-cache-20260904 --no-audit --no-fund`.
`node_modules` is a real directory owned by this checkout, not a shared symlink.
Next `16.3.2`, use-stick-to-bottom `1.1.6`; package.json and lockfile unchanged.
No test-only dependency aliases. Default Vitest/Vite caches are local to this
checkout's own node_modules, with result cache disabled for test runs.
Read root AGENTS, operating truth, north star, release/acceptance and browser
runbooks, worker/transport READMEs and installed Next use-client/Vitest guides.
Current task/repository instructions override the older GraphikAI product skill.

## Local gates and evidence

- Consolidated union of every test file listed in A1/B/C notes, plus
  `tests/component/chat-workspace.test.tsx`: 24 files, 191 tests; 190 passed,
  one gateway recovery test timed out at 5 s and its teardown reported ENOTEMPTY.
  Log: `/tmp/aibrain-f-tests-20260904.log`. ChatWorkspace collected with the real
  dependency and passed. Command: `npx vitest run <that file union>
  --maxWorkers=1 --no-file-parallelism --cache=false --silent`.
- After fixture correction, `npm run typecheck` passed; ESLint on all changed
  TypeScript/test files passed with `--max-warnings=0`.
- `npm run contracts:verify`: PASS, pinned 0.149.1 contracts only, no provider call.
- `npm run infra:validate`: static gates PASS; Docker Compose execution NOT RUN
  because Docker CLI is unavailable.
- Follow-up: **5 files / 58 tests PASS, 93.57 s**. Exact files:
  `src/runtime/workers/local-gateway-runtime.test.ts`,
  `tests/unit/frame-event-dispatcher.test.ts`,
  `tests/contract/aibrain-http-contract.test.ts`,
  `tests/unit/release-manager.test.ts`,
  `tests/integration/multi-user-worker-acceptance.integration.test.ts`.
  Command: `npx vitest run <these five files> --maxWorkers=1
  --no-file-parallelism --cache=false`.
  Log: `/tmp/aibrain-f-followup-20260904.log`. The gateway suite passed unchanged;
  the initial timeout was not reproduced and is retained as a QA stability
  caveat, not silently relabeled as a clean first run. No product fix or timeout
  increase was made for it. Across both runs, all 27 distinct suites / 227
  distinct tests passed at least once; the full union was not rerun after the
  fixture-only correction.
- Final diff check passed. Pre-candidate fetch again confirmed
  `origin/main=048a7d4cef7752fe716f66e84e5c52f7ec663022`.

These are unit/component/jsdom, fake-CDP and local fake-provider/process tests,
not real Chromium input or authenticated/live acceptance. No build/full-suite
loop, real Codex invocation, paid API, external test action, customer data or
production access. CI, GHCR, deploy, Linux/container cleanup, live timing and
authenticated acceptance remain separate, unperformed gates.

## QA handoff

The functional QA exclusively owns the heavy browser slot after F finishes.
No server is left running. Prepared isolated installation config:
`/tmp/aibrain-f-playwright-20260904.json`, public URL `http://127.0.0.1:3194`,
all writable fixture roots under `/tmp/aibrain-f-qa-20260904`.
Do not reuse the default shared example data roots or customer configuration.

From the candidate checkout, a bounded existing fixture entry point is:

```sh
PLAYWRIGHT_PORT=3194 PLAYWRIGHT_INSTALLATION_CONFIG=/tmp/aibrain-f-playwright-20260904.json npx playwright test tests/e2e/streaming-fluidity.spec.ts tests/e2e/durable-performance.spec.ts tests/e2e/theme-keyboard-degraded.spec.ts --project=chromium-desktop --workers=1
```

The Playwright config starts loopback-only demo auth/runtime automatically.
Inspect each fixture before execution; mocked streams/viewer frames do not prove
real remote-CDP typing. Functional QA should explicitly adjudicate real viewport
focus/click/key/paste/scroll, thread switch and reconnect using safe local data.
Runtime QA can rerun A1's seven files plus multi-user acceptance with one worker;
focus on init concurrency, surviving descendants, failed cleanup fencing and
one durable final. Use this checkout's complete dependencies read-only or a new
locked isolated install; do not mutate shared node_modules/caches. Any new QA
artifacts/configs belong outside tracked code, and no extra tasks are required.
