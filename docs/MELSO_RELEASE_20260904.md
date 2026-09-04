# Arnall release integration — 2026-09-04

Publication and deployment are explicitly authorized for this release. This
supersedes the no-publication boundary in the historical Melso reports, not
their evidence limitations. No customer credentials, source data, goals or
scheduled jobs are created or copied by this integration.

## Inputs preserved

- Release worktree: `AiBrain-release-20260904`, based on freshly fetched
  `fd1462ac74562b1dd2fcf49f2bfdd8b9a0e27525` (`origin/main`).
- Normal merge of `0ebdfc053cbb29b2f388b36269c025dab4bbe3db`, preserving
  Arnau's intervening UI/accessibility and memory changes and all candidate
  history. The original candidate checkout remains unchanged.
- Browser panel and component-test conflicts require the new pointer-drag and
  immediate accessible-close behavior to coexist with bounded input queues,
  attachment ownership, late-takeover compensation and cancellation on detach.

The merged runtime resets a possibly held left mouse button on its owned page
inside the serialized controller boundary, before releasing control or activating
a successor. A press is tracked before dispatch because a lost reply does not
prove it failed; queued input from an older control generation is rejected.
Three regression tests cover release, successor and lost-response behavior.
No detached frontend input is replayed. The compact-modal assertion now checks
the retired attachment is absent and the current closed panel is inert/hidden,
while retaining focus-trap and focus-return checks.

## Gates

The initial combined runtime/release slice passed 122 tests in 14 files, with
one local worker (85.94 s). Generated Codex contracts and static infrastructure
validation passed. Local Docker validation is unavailable. Final merged browser
runtime/registry/input and browser/sidebar components passed 60 tests in five
files (14.97 s, one worker), including the three held-input regressions. Full
TypeScript checking (`--noEmit --incremental false`) and full ESLint with zero
warnings passed. Test suites overlap; their counts are not additive coverage.

Linux quality, filesystem/restart E2E, native document matrix and production
container acceptance remain the existing Backend CI gates. No gate is lowered.
The existing Backend CI -> GHCR immutable images -> restricted Hetzner gateway
chain performs publication; no production build is permitted.

At preflight the controlling release state and running services reported
`fd1462ac74562b1dd2fcf49f2bfdd8b9a0e27525`, with app digest
`sha256:f8e38e6b1b75cd602f3c63ce019988e6dcfb78dca5024df1ef3c5c2b52c9de4c`
and gateway digest
`sha256:04eb8be184478ef92e8c04d37cf4f4537a314d00b19a7882120261fd02d92dbf`.
Readiness passed all required components, with approximately 50 GB available.
This is previous-release preflight, not acceptance of the merged release.

A fresh Arnall browser tab confirms David's existing authenticated identity.
Real model turns, browser interaction, documents/previews and persisted final
state must be checked again after the new release identity is verified.
Historical local CLI inference, synthetic sessions and the uncollected cloud
task do not substitute for these live checks.

## First CI result and bounded correction

Backend CI `33891075724` for `f1c77b7fc493a46a931bd2e854d81dd9d6d4845e`
passed quality (1,246 tests; 13 opt-in tests skipped), native documents and
clean container/App Server acceptance. UI E2E passed 62 cases, skipped the
opt-in real-provider case, and failed only `streaming-fluidity` in all three
attempts: 72 input deltas produced 76 DOM mutations, below its >100 assertion.
That count depended on the removed artificial text-reveal subdivision.

The corrected fixture sends 144 deltas at the unchanged 80 ms interval and
checks all 24 headings and all 144 paragraph fragments after completion.
The >100 frame/mutation thresholds and controlled-run timing budgets remain
unchanged. This increases the workload; no production code or gate is weakened.
This first CI result did not publish or deploy an image. The correction requires
its own exact-SHA successful pipeline before live acceptance.

The corrected fixture's local warm run verified every heading/paragraph and
149 mutations. Its optional 4x CPU-throttled timing check failed on the shared
Mac: p95 frame gap 50 ms (requires <50), 7,665 ms cumulative long tasks (requires
<500); slow-frame ratio was 0.0433. This is not a performance pass, and no budget
was changed. A cold run first exceeded the whole-test 30 s deadline while the
development shell compiled. The local bundler used webpack because Turbopack
rejects this worktree's dependency symlink. These local limitations are distinct
from the unchanged CI behavioral mode and later authenticated live evidence.
