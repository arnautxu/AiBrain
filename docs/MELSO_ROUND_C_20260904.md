# Melso round C — Browser input and replay boundary

Date: 2026-09-04. Implemented locally only; no push, deployment, real provider,
customer account or live acceptance. Worktree: `AiBrain-melso-c-20260904`.
Baseline and freshly fetched `origin/main` before commit:
`048a7d4cef7752fe716f66e84e5c52f7ec663022` (unchanged).

## Sources and independent adaptation

Read AiBrain `AGENTS.md`, `docs/OPERATING_TRUTH.md`,
`docs/PRODUCT_NORTH_STAR.md`, `docs/BROWSER_COMPUTER_USE_RUNTIME.md` and the local
Next server/client component guide before editing. Existing automatic memory,
Arnau UI and company/project/chat ownership remain unchanged; historical manual
approval language in the browser runbook was not reintroduced.

Melso was inspected read-only at
`7c667dd1a41fee4bc2b5172649527cf9f4d26771`, after root AGENTS/CLAUDE:

- `server/pkg/agent/browser_mcp_config.go`: Windows MCP executable/config
  hardening; not evidence of an interactive Computer viewer.
- `server/pkg/agent/claude.go`, `writeMcpConfigToTemp`: bounded task-local private
  configuration and ownership of its temporary lifetime.
- `server/internal/daemon/runtime_mcp.go`: configuration is merged locally;
  secret-bearing command/config details are excluded from public inventory.
- `server/internal/daemon/processtree/run.go`: cancellation owns the exact
  launched process tree, distinct from reconnecting a UI attachment.

No reuse license was evidenced. No source was copied or executed. The changes
below independently implement ordered input and attachment lifetime boundaries
using existing AiBrain contracts; no daemon, fleet or new platform was added.

## Defects and fixes

1. Browser handlers sent independent HTTP mutations. Delayed takeover/clicks
   allowed subsequent typing/scrolling to interleave between down/up events.
   A per-attachment lane now serializes complete event groups, snapshots event
   data synchronously and bounds pending groups to 128 with visible rejection.
   Failure cancels dependent queued input rather than continuing into uncertain
   focus/navigation. Closing/changing thread fences pending continuations and
   resets frames/tokens. Click focuses the viewport; paste is inserted once and
   Ctrl/Meta shortcuts do not insert printable text. Control tokens renew before
   30-second expiry (25-second conservative window from request start); rejected
   mutations are never retried, and a rotated session cannot receive old input.
2. Manual CDP input/navigation used the stale-page read retry path. A new failing
   regression reproduced a key being silently dispatched twice. These mutation
   paths now propagate failure without replay, including stale failures during
   post-navigation/reload readback. Read-only frame target recovery is retained.
   Existing server recovery/error propagation and durable agent indeterminate
   semantics are unchanged; this does not add a new manual-input journal.

## Validation

All runs use one worker, synthetic fixtures/fake CDP/processes and private Vite
cache `/tmp/aibrain-melso-c-20260904-vite`; config loading uses `native` to avoid
the shared dependency config cache. No general build or full suite was run.
Shared dependencies were read-only. Missing icon/class helper packages were
installed from the existing npm cache into `/tmp/aibrain-c-deps.gUzRYE`, with
test-only aliases; no shared `npm ci` or dependency mutation.

- First, the new manual stale-CDP regression failed against the original runtime:
  operation resolved instead of rejecting (replayed input).
- `vitest run --maxWorkers=1` on `src/ui/browser-input-queue.test.ts`,
  `src/runtime/browser/{chrome-runtime,browser,server-service}.test.ts`,
  `tests/integration/browser-routes.integration.test.ts`,
  `src/ui/browser-frame-stream.test.ts`, and
  `tests/component/browser-panel.test.tsx`: **50 passed**.
- After two additional UI regressions, `tests/component/browser-panel.test.tsx`,
  `tests/component/spreadsheet-preview.test.tsx` and
  `src/runtime/enterprise-documents/spreadsheet-artifact.test.ts`: **20 passed**.
  There are **63 unique tests** across these nine files (the panel overlaps).
- Final combined rerun of all nine files after the last code change:
  **63 passed**, 12.83 seconds.
- ESLint on all six changed TypeScript/test files: passed with zero warnings.
  `git diff --check`: passed.

Coverage includes exact rapid click/type/Unicode paste/scroll order under delayed
takeover; expiry renewal; session/thread fencing; no dependent input after an
uncertain result; queue bounds; reconnect without input replay; close without
Chrome stop; stale-CDP mutation/readback no-replay; existing user/thread/auth
negative boundaries; existing spreadsheet persistence and preview behavior.

## Remaining gates / scope limits

UI interaction is exercised through jsdom DOM events and a mocked backend, not a
real Chrome viewport. Runtime tests use fake CDP, not a live website. Actual
Chromium end-to-end keyboard/clipboard/layout acceptance remains for bounded QA;
no live acceptance is claimed. No broad typecheck/build was run. No document
preview code was changed. No blockers to integrating this isolated commit.
