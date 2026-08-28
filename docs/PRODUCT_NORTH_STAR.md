# AiBrain product north star

Last evidence refresh: 2026-08-28 13:20 Europe/Madrid.

AiBrain is a reusable company-brain installation, not a single-user demo. Its
release is successful only when two real company users can work concurrently
through the same deployed installation while their projects, threads, files,
browser state and permissions remain isolated. Each real turn must stream,
reach one exact terminal state, survive restart, perform an explicitly allowed
real action, and be traceable from the release SHA through the user, thread and
runtime turn without exposing secrets.

This document records product truth. It uses only `not started`, `implemented`,
`validated locally`, and `validated live`. Evidence from the current
`origin/main` baseline is not acceptance of a future release candidate.

## Capability evidence map

| North-star capability | Product contract | Code | Test / evidence | Current state | Missing proof |
| --- | --- | --- | --- | --- | --- |
| Two real users are isolated | A principal can read and mutate only resources authorized for that principal; a denied request must not open another user's durable store | [project APIs](../src/app/api/projects), [runtime permission turn](../src/runtime/permission-turn.ts), [permission provider](../src/permissions/markdown-permission-provider.ts) | [multi-user worker acceptance](../tests/integration/multi-user-worker-acceptance.integration.test.ts), [permission-turn tests](../src/runtime/permission-turn.test.ts) | implemented | K1 must prove pre-retrieval project ACL with zero foreign-store reads; final candidate needs live David/Arnau positive and negative readback after restart |
| A real Codex turn completes | A submitted turn has a durable identity and exactly one terminal outcome | [Codex worker](../src/runtime/worker-codex-turn.ts) | [worker tests](../src/runtime/worker-codex-turn.test.ts), [multi-user worker acceptance](../tests/integration/multi-user-worker-acceptance.integration.test.ts) | validated locally | Run one real turn per provisioned user on the immutable candidate and read back thread ID, runtime turn ID, terminal status and persisted response |
| Streaming is truthful | Text and tool activity arrive before one terminal event; reconnect does not duplicate or fabricate completion | [turn projection store](../src/workbench/turn-projection-store.ts), [chat API](../src/app/api/chat/route.ts) | [turn projection tests](../src/workbench/turn-projection-store.test.ts) | validated locally | Candidate live timestamps for first text and terminal event, reconnect readback and zero duplicate/error events |
| Work survives restart | Projects, threads, messages, artifacts and terminal turn state persist across an application restart | [project APIs](../src/app/api/projects), [artifact APIs](../src/app/api/projects/[projectId]/artifacts) | Current `main=9fe848ae…` passed CI filesystem/restart job in [run 33164764500](https://github.com/arnautxu/AiBrain/actions/runs/33164764500) | validated live | Repeat CI on the candidate, restart Arnall, then read back the same two users' exact resources and turn state |
| Permissions are server-enforced | Authorization and approval decisions occur before access/action and are durably auditable | [permission turn](../src/runtime/permission-turn.ts), [permission audit sink](../src/runtime/permission-audit-sink.ts), [permission provider](../src/permissions/markdown-permission-provider.ts) | [permission-turn tests](../src/runtime/permission-turn.test.ts), [permission-provider tests](../src/permissions/markdown-permission-provider.test.ts) | validated locally | Durable enterprise roles/membership; K1 pre-retrieval ACL; artifact publication freeze/confirm/permission/audit; live authorized and denied actions |
| One bounded real action has readback | An approved action returns evidence from its controlling system and never claims safe failure when outcome is indeterminate | [browser service](../src/runtime/browser/server-service.ts), [artifact route](../src/app/api/projects/[projectId]/artifacts/[artifactId]/route.ts) | Browser/tool and files/artifacts workstreams have identified missing mutation-readback and publication-approval gates | implemented | Integrate owner units, execute one approved candidate action, and read back final URL, artifact hash or publication receipt plus audit link |
| Files and knowledge are durable and safe | Uploaded and generated material is isolated, recoverable, permissioned and cannot escape storage boundaries | [artifact APIs](../src/app/api/projects/[projectId]/artifacts), [artifact store tests](../src/artifacts/store.test.ts) | Files unit `c1c084910a32b357274c7e0a844c57e7a126bd3e` fixes the `server-only` test boundary; owner reports 4 files/10 artifact tests, 5 files/41 document tests and typecheck green | validated locally | Integrate and rerun F1; close durable publication approval, crash/idempotency and symlink-parent negatives; close K1 foreign-store prevention |
| Observability correlates product truth | Release, installation, principal, thread, turn, permission/action outcome and persisted result can be correlated without secrets | [usage service](../src/usage/server-service.ts), [permission audit sink](../src/runtime/permission-audit-sink.ts), [health API](../src/app/api/health/ready/route.ts) | Current deploy [33165012869](https://github.com/arnautxu/AiBrain/actions/runs/33165012869) identifies `9fe848ae…` and immutable digests; public health is 200 but omits revision | implemented | Candidate host release-state and OCI readback plus correlated structured logs/audit for both users and the real action |
| Product UI exposes only real capabilities | Navigation and controls reflect server-side availability and do not bless loading errors or QA-only surfaces | [workbench components](../src/components), [settings API](../src/app/api/settings/route.ts) | Dirty visual set is held: `preferences-dark` records a settings-load error; current login exposes `data-installation="company-qa"` for acceptance review | implemented | UI owner resolves settings/error state; server-side capability flags hide unavailable tools; acceptance proves no inappropriate QA/demo shortcut on the candidate |
| Release is reversible without data loss | The exact immutable candidate can roll back to the preserved previous release and return, with identity and data intact | [release runbook](RELEASE_AND_ACCEPTANCE_RUNBOOK.md), [release manager tests](../tests/unit/release-manager.test.ts) | Current `main=9fe848ae…` is deployed with recorded app/gateway digests; rollback logic is locally covered | validated locally | Exercise A ← B rollback on Arnall, read back A data/identity, re-promote unchanged B and repeat critical acceptance |

## Release-level success condition

The product north star is met only when every mandatory row in
[the definition of done](DEFINITION_OF_DONE.md) is closed against the same full
candidate SHA after deployment and restart. Green health, localhost/demo tests,
generated snapshots or a deploy log alone cannot substitute for two-user live
readback, a real turn, persisted state, a denied access, an approved real action
and rollback-and-return evidence.
