# Final B correction pass — 2026-09-04

## Scope and provenance

Dedicated worktree: `/Users/davidliria/Documents/AiBrain-melso-final-b-20260904`, branch `codex/arnall-melso-final-b-20260904`. Clean starting HEAD: `3a95d9d110591a892fbacc870a174cacaf0611bc` (integrated F candidate). This is a narrow correction of the three independently reproduced findings in `AiBrain-coordination-20260904/qa-runtime/REPORT-R2.md`, not a new Melso import. Prior design/provenance remains in `MELSO_R2_B_20260904.md` and `MELSO_R2_F_20260904.md`.

Before edits, the original read-only external fixtures under `/tmp/aibrain-qa-runtime-r2-20260904` were run against **this worktree's source**, not the QA checkout. `private-prefix.test.ts`, `final-priority.test.ts`, and `adversarial.test.ts`: **3 failed / 1 passed** on the exact baseline. Observed failures:

- P1: public delta included `QA_PRIVATE_MARKER` from a known workspace with spaces, before complete-root replacement.
- P2: started/delta/completed legacy item published `Unclassified trailing message` after an explicit final, then terminal reconciliation restored the final.
- P2: delta seq 1 → foreign-ID snapshot seq 2 → original-ID snapshot seq 3 resolved successfully and advanced the stored cursor to 3.

No QA source/artifact edits; the temporary config imports this worktree's base config, retains its `@` source alias, and points only test discovery to the external fixture directory. Its Vitest module alias uses F's shared dependencies. Own caches are `/tmp/aibrain-final-b-repro-cache` and `/tmp/aibrain-final-b-focused-cache`.

## Corrections

1. **Known roots before word boundaries.** Extracted `privateWorkspaceSafeText` into a testable server utility. It substitutes complete known absolute roots and withholds a trailing proper prefix of a known root before the worker computes its publishable lexical prefix. Longer partial roots are checked before shorter complete roots. Spaces and literal single/double quotes inside roots cannot expose later root segments. A lone slash contains no private material and is retained for public punctuation/URLs. Final text and recovery use the same sanitizer; running commentary now applies known-root protection before its word boundary too. Ordinary literal spans are skipped in bulk; no whole-answer buffer or extra RPC was introduced.
2. **Explicit final wins live as well as terminal.** Both delta publication and item reconciliation reject legacy candidates once an explicit final phase is known. Raw candidate tracking is retained, but rejected candidates never become public content. Missing lifecycle phase metadata preserves an already known phase. Legacy-only turns still publish and select the last legacy item; no text/keyword inference. Recovery's existing final-over-legacy selection is covered by a later-legacy regression.
3. **Snapshot binding per event.** Every transport snapshot is checked against the stored assistant ID, assistant role and immutable message `createdAt` before replay/cursor decisions. Equality to the already validated original timestamp also enforces its canonical form. A later valid snapshot cannot mask an intermediate invalid one. Exceptions occur before the single atomic-write boundary. The same binding check also protects local snapshot application. Full-transcript validation stays at the batch boundary: the existing 64-delta/80 KB regression still asserts exactly **3** full-message validations (not the previous 66).

## Validation

- Original external fixtures after correction: **4/4 PASS**, all three former failures resolved, sources unchanged.
- Focused versioned suites: **46/46 PASS, six suites**: worker, private-workspace text, public activity, turn projection store, chat route and recoverable stream.
- The prefix corpus checks every cumulative character prefix, overlapping roots, wrappers, spaces and both quote types. Worker regression delivers a private path one character at a time and checks all public deltas/content for the marker. The four-format real local document fixture now uses a quoted workspace root and retains exact final text/artifact checks.
- Live regression covers ordinary streaming before an injected 15 ms delay, authoritative replacement by another explicit final, later started/delta/completed legacy traffic, missing completion phase, and a legacy-only control. Recovered final remains authoritative with a later legacy item.
- Atomic regression covers intermediate foreign ID, user role, changed canonical timestamp and equivalent noncanonical timestamp, each followed by a restoring valid snapshot. Store contents and cursors remain unchanged after rejection; valid same-binding snapshots remain accepted.
- Typecheck: **PASS**, `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Targeted ESLint: **PASS**, all six changed/new TypeScript source/test files. `git diff --check`: **PASS**.

Final focused run: 46/46, 4.91 s. Final external run: 4/4, 2.56 s. These are local test durations, not provider performance metrics. A repeated typecheck initially found the shared lock busy and did not execute or remove it; the subsequent acquired run passed. Pre-commit fetch confirmed unchanged `origin/main=048a7d4cef7752fe716f66e84e5c52f7ec663022`; the assigned integration baseline was preserved, with no remote merge or publication.

All jobs use atomic `mkdir /tmp/aibrain-r2-tests-20260904.lock`, run only after successful acquisition, and release only their own lock. Vitest uses `--configLoader native --maxWorkers 1`, private cache and `test.cache=false`; dependencies are an ignored worktree-local symlink to F's `node_modules`, never installed into or modified. One initial focused invocation stopped at CLI parsing because `--silent` consumed the following filename; rerun with `--silent=true` passed. This was not a test failure.

## Limits / remaining gates

This is protection of **known literal workspace roots** plus the existing generic sanitizer, not arbitrary-secret detection or normalization of every possible escaped/encoded path. Ambiguous trailing known-root fragments are withheld; ordinary incomplete lexical tokens still wait for a safe boundary or completion. Accumulated bounded text is still revisited; no constant-time, RSS or real-provider latency claim is made.

The changed code has local synthetic transport and actual local-document evidence only. No provider login/account use, Linux/Docker acceptance, browser, build, E2E, CI/GHCR, push or deploy was performed. C/QA retain independent acceptance. ACK/ENOTEMPTY, historical EPERM, disk/QPDF and provider-auth findings are not declared resolved by this pass. Melso, F, QA and the old B worktree were not edited; no A1 transport ownership changes, client data mutation or automatic-memory changes.
