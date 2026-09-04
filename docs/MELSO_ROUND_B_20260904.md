# Melso round B — immediate paint batching

## Scope and source

- Worktree: `AiBrain-melso-b-20260904`, branch `codex/arnall-melso-b-20260904`.
- Baseline and both fetched `origin/main` readbacks: `048a7d4cef7752fe716f66e84e5c52f7ec663022`; main did not advance.
- Read repository AGENTS, OPERATING_TRUTH, PRODUCT_NORTH_STAR, release runbook and PERFORMANCE_BUDGETS; local Next `use-client` guide was read from the existing AiBrain dependency installation.
- Melso was inspected read-only at `7c667dd1a41fee4bc2b5172649527cf9f4d26771`, after AGENTS/CLAUDE. Relevant references: `packages/views/issues/components/issue-run-session-model.ts` (`issueRunToChatMessages`: live timeline versus terminal message); `server/pkg/agent/stream_json_result.go` and `stream_json_final_output_test.go` (authoritative terminal output, no preceding narration/tool trace in final). `packages/core/chat/message-cache.ts` was also inspected for message identity. No Melso code copied, dependencies added, app/tests/daemon run, or reuse license assumed. Implementation is independently expressed against AiBrain's existing dispatcher and reducer.

## Implemented

One production fix: `src/ui/frame-event-dispatcher.ts` no longer slices received text into 16 reveal steps or waits for alternating frames. The first nonempty chunk is applied in full synchronously; subsequent arrivals are coalesced and drained in full at the next animation frame, with the existing 48 ms fallback. Non-delta events and close flush exactly before continuing. Empty deltas do not schedule work. Sanitization remains upstream and unchanged.

Existing baseline behavior retained, not claimed as new implementation:

- Runtime already routes phased commentary into activity and final-answer text into content (`upsertCommentary`, `emitFinalChunk`, `agentMessagePhases` in worker-codex-turn). No backend hotspot modification or protocol proposal is required.
- TurnActivity already expands live work and collapses terminal work under “Ha trabajado…”. ChatWorkspace renders final content outside that disclosure. No private reasoning is promoted to public content.
- `brain-app.tsx` derives `sending` for the active thread/draft, while `selectThread` and `startNewThread` do not guard on another turn's running state. Sidebar receives `actionBusy`, not global generation state. Document-upload navigation protection remains intentionally unchanged.
- Spreadsheet/result artifact code is unchanged.

## Local verification

Final targeted run: **7 files, 30 tests passed, 9.38 s**, one worker. Files:

```text
tests/unit/frame-event-dispatcher.test.ts
tests/unit/client-turn-performance.test.ts
tests/unit/turn-timeline.test.ts
tests/component/turn-activity-timeline.test.tsx
tests/component/sidebar.test.tsx
tests/unit/recoverable-chat-stream.test.ts
tests/unit/durable-chat-event-adapter.test.ts
```

Command: `node node_modules/vitest/vitest.mjs run --config .vitest-b.config.mts <files above> --maxWorkers=1`.
The temporary local config merged vitest.config.mts, set `cacheDir` to `/tmp/aibrain-melso-b-20260904-vite`, and disabled Vitest's result cache; it was removed after verification. Dependencies were read through a worktree-local ignored symlink to `AiBrain-release-owner-20260902/node_modules`; no shared install or npm ci was performed.

Added assertions cover large first chunk synchronously, 10,000 Unicode chunks in a single paint batch, full fallback drain, exact terminal flush, mixed commentary/tool/final projection with repeated snapshot replacement, same-mounted live-to-terminal collapse and sidebar create/navigation while selected chat works. Existing durable-adapter tests verify replay cursor deduplication and terminal rejection; raw text deltas alone have no event identity and are not claimed independently deduplicable. Updated telemetry expectations remove the synthetic third reveal paint (two real text paint opportunities, same measured terminal time).

`git diff --check` passed. No build, E2E, real Codex/provider call, push or deploy.

## F follow-up / limitations

- `tests/component/chat-workspace.test.tsx` could not collect because all inspected existing AiBrain dependency installations lack `use-stick-to-bottom` (lockfile pins 1.1.6). Do not call the full final-only component gate passed. Run it on F's dependency-complete candidate; its existing first test checks rich final Markdown once, outside collapsed commentary. The focused activity transition and reducer tests above passed without substituting a mock for the missing hook.
- Initial dependency probe using original AiBrain modules lacked `@base-ui/react`; switching to the release-owner installation resolved that. A temporary config import extension was corrected before the final green run. Initial telemetry assertion failed as expected on the removed synthetic paint and was updated to the measured two-paint contract.
- PERFORMANCE_BUDGETS remains intentionally untouched because it is shared documentation. F should replace its present-tense adaptive-30fps/reveal-queue descriptions with: “First chunk applied immediately in full; subsequent chunks coalesced in one paint batch, drained at the next rAF or 48 ms fallback; exact flush before non-delta/terminal events.” Preserve historical measurements as historical, not new live evidence.
- Legacy unphased backend messages retain the baseline compatibility fallback; this UI change cannot infer missing provider phase information. Live browser timing and authenticated final-only acceptance remain unmeasured.
