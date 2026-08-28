# AiBrain project execution board

Last evidence refresh: 2026-08-28 13:20 Europe/Madrid.

This board records observed state. It is not a roadmap and it does not promote
an item merely because code exists. The only allowed states are:

- `not started`: no received implementation or no evidence inspected.
- `implemented`: code or documentation exists, but the required local gate has
  not passed on the exact integrated revision.
- `validated locally`: the exact revision passed the cited local or CI gate,
  but the release-candidate behavior has not been read back from Arnall.
- `validated live`: the controlling external system or Arnall returned the
  cited evidence for the exact revision.

## Git and release baseline

| Item | State | Exact evidence | Remaining gate |
| --- | --- | --- | --- |
| Fetched remote baseline | validated locally | `origin/main=9fe848ae84ca808533dceb1c8a43779abe1e221a`; it advanced from `390bbb06…` during this audit | Re-fetch immediately before integration and treat every workstream based on `d381ccf` as requiring the one-commit main delta |
| Original integrated checkout preserved | validated locally | `/Users/davidliria/Documents/AiBrain`, branch `codex/aibrain-integrated-qa`, HEAD `8d2616657fa16a55b001a133dfee7b6bbba739e2`, clean, two commits ahead of its remote | Do not merge, rebase, reset or clean this checkout |
| Today integration checkout preserved | validated locally | `/Users/davidliria/Documents/AiBrain-today-integration`, branch `codex/aibrain-today-integration`, HEAD `d381ccf836516f91464f20225403996e7e8158d1`, 64 tracked modifications | Keep all 7 text changes and 57 snapshots until their owner and tests resolve them |
| Release-coordination worktree | validated locally | `/Users/davidliria/Documents/AiBrain-release-coordination`, branch `codex/aibrain-release-coordination`, rebased before edits onto current `origin/main=9fe848ae84ca808533dceb1c8a43779abe1e221a`; pre-refresh HEAD `93f058547163ef4ef6d04812d21858955f9f1a28`; governance root `90d28cf` | Keep local; no push or deploy |
| Current `main` CI | validated live | [Backend CI run 33164764500](https://github.com/arnautxu/AiBrain/actions/runs/33164764500) passed all four jobs for `9fe848ae84ca808533dceb1c8a43779abe1e221a` | Baseline only; repeat for the future integrated SHA |
| Last fully validated CI baseline | validated live | [Backend CI run 33157502708](https://github.com/arnautxu/AiBrain/actions/runs/33157502708), four jobs green for SHA `390bbb06…` | Historical baseline only; it is no longer current `main` |
| Current Arnall deployment | validated live | [Deploy run 33165012869](https://github.com/arnautxu/AiBrain/actions/runs/33165012869) logged `ARNALL_DEPLOY_OK revision=9fe848ae…`; app digest `sha256:671d7f65…`, gateway digest `sha256:926117c1…`; [live](https://arnall.graphikai.com/api/health/live) and [ready](https://arnall.graphikai.com/api/health/ready) returned HTTP 200 with all checks/components `OK` | Public health does not expose revision; this is ops-baseline health, not functional acceptance |

## Integration units

No unit below is authorized for push or deployment by this board.

| Unit | Contents and ownership | State | Evidence inspected | Next gate |
| --- | --- | --- | --- | --- |
| G0a | Release governance documents; release coordinator | validated locally | Commits `90d28cf`, `61b0644`, `93f0585`; this file, [definition of done](DEFINITION_OF_DONE.md), and [release runbook](RELEASE_AND_ACCEPTANCE_RUNBOOK.md); branch based on `9fe848ae…` | Refresh links/diff check after every handoff; keep local |
| G0b | Evidence-backed [product north star](PRODUCT_NORTH_STAR.md); release coordinator | validated locally | Separate commit `549e74527229995320dcdd27518ed0c7c7f3934d`; capability map links product contract to existing code/test targets, current evidence state and missing proof; diff check and local targets validated | Keep local and update only from readback; do not push |
| I1 | Arnau UI refinement | implemented | Source `c2bece6`; merge `d77f239` in `today-integration`; merge touches `turn-activity`, component test and conversation E2E | Rebase-free reconstruction or reviewed merge on the future integration branch, then focal UI tests |
| I2 | Full work-parity branch | implemented | `codex/aibrain-work-parity` at `d388380`; merge `d381ccf` resolved conflicts in `package.json`, lockfile and filesystem store files | Validate conflict resolutions and run contract/unit/integration slices on exact merge |
| I3 | Today post-merge text fixes | implemented | Uncommitted schema expansion, explicit `server-only` dependency, artifact test mock, demo feature policy, publication disk-threshold fixture, plus generated `next-env.d.ts` path churn | Convert only through the dirty-change ledger below; never commit the dirty worktree as one unit |
| I3b | Files/artifacts `server-only` boundary; files owner; accepted by master as a release-candidate unit | validated locally | `codex/aibrain-files-artifacts@c1c084910a32b357274c7e0a844c57e7a126bd3e`, base `d381ccf836516f91464f20225403996e7e8158d1`, 3 files +11/-1; exact blobs match the three dirty files; owner: artifact slice 4 files/10 tests, document slice 5 files/41 tests, typecheck and diff check green | Integrate only when the release candidate opens; rerun the focal artifact slice and typecheck on the resulting integrated SHA; Files remains open for approval/idempotency/symlink gaps |
| I4 | Today regenerated visual baselines | implemented | 57 modified PNGs: 47 visual-matrix, 6 capabilities, 4 review; dimensions unchanged; pixel-change range 1.92%-99.75%; inspected `preferences-dark` captures a settings-load error | Blocked from integration until visual/settings owners explain the error state, provide deterministic commands, review diffs and pass the exact matrix |
| I5 | UI, runtime, auth, knowledge, files, tools, connectors, tasks/voice, ops and acceptance deliveries | implemented | F1/I3b and Runtime R1 are received below; neither is integrated | Record every remaining commit, diff, tests and owner before conflict analysis |
| I6 | Runtime reconnect ownership; runtime owner | implemented | `codex/aibrain-runtime@7b4045d89bdc58beecdddcca03b2c42b62db6995`, base `d381ccf836516f91464f20225403996e7e8158d1`, 3 files +295/-6; clean worktree. Owner reports new abort regression 1/1, TypeScript, focal ESLint, diff check and `contracts:verify` green. The combined 8-file/36-test run had two timed integration tests exhaust fixed ceilings; their reruns are environmental-inconclusive, not green | Re-run the two timed integration tests in a quiet runner before integrating; then execute the focal runtime slice on the integrated SHA |
| R1 | Final integration into `main` | not started | No release-candidate SHA exists | All dependencies received; local slices and coordinated full suite green; rollback inputs fixed |
| R2 | Immutable Arnall deploy and acceptance | not started | Current live ops baseline is `9fe848ae…`, not the future candidate | CI green, deployment readback, restart, two-user acceptance and rollback rehearsal |

## Workstream handoff ledger

| Workstream / task ID | Received branch / SHA | State | Conflict owner |
| --- | --- | --- | --- |
| UI `01a047f6-cf20-77a3-a8b6-9104f9e71420` | `codex/aibrain-ui-functional-parity` at authorized base `d381ccf836516f91464f20225403996e7e8158d1`; commit delivery pending; owns `CHATGPT_WORK_PARITY_MATRIX.md` | not started | UI owner |
| Runtime / streaming `01a047f9-eefc-7911-8e5b-ff6f2591ba12` | `codex/aibrain-runtime@7b4045d89bdc58beecdddcca03b2c42b62db6995`, base `d381ccf836516f91464f20225403996e7e8158d1`, clean, 3 files +295/-6. Separates client NDJSON disconnect from server-owned turn lifetime; adds abort regression and `PERFORMANCE_BUDGETS.md`. Owner reports 1/1 new regression, TypeScript, focal ESLint, diff check and `contracts:verify` green; two timed integration reruns remain inconclusive under contention | implemented | Runtime owner; do not integrate until the two timed tests pass in a quiet runner |
| Auth / permissions `01a047f7-d8f7-7971-a4ad-1a8aa470b612` | `codex/aibrain-auth-security` at authorized base `d381ccf836516f91464f20225403996e7e8158d1`; proposed durable replacement for `AIBRAIN_USAGE_ADMIN_USER_IDS`; owns `ARCHITECTURE_AND_TRUST_BOUNDARIES.md`; no commit delivery yet | not started | Auth owner |
| Threads / projects / knowledge `01a047f8-e2e9-7770-a17c-54e2cb48d1dc` | K1 authorized from exact base `d381ccf836516f91464f20225403996e7e8158d1` on `codex/aibrain-knowledge-acl-k1`: durable pre-retrieval ACL, provenance/audit and zero foreign-store reads; schema explicitly excluded | implemented | Knowledge owner |
| Files / artifacts `01a047fb-fff7-7d62-9a10-344b7e553d07` | `codex/aibrain-files-artifacts@c1c084910a32b357274c7e0a844c57e7a126bd3e`, base `d381ccf836516f91464f20225403996e7e8158d1`, 3 files +11/-1 | validated locally | Files owner; F1 accepted as I3b, but durable approval, crash/idempotency and symlink-parent remain open |
| Tools / browser `01a047fa-f8ce-77f1-8528-623d9e09baf6` | Base `d381ccf836516f91464f20225403996e7e8158d1`; B1 limited to non-retry/indeterminate mutation outcome and evidence tied to audit/approval; delivery pending | not started | Tools owner |
| Connectors `01a047fc-ecfe-7cf2-bef6-c9745ac71ad8` | Base `d381ccf836516f91464f20225403996e7e8158d1`; fail-closed server-only registry/credential-reference core proposed; delivery pending | not started | Connectors owner |
| Tasks / voice `01a047fd-df63-7260-abbe-06ae3705a838` | Base `d381ccf836516f91464f20225403996e7e8158d1`; T1 limited to fail-closed lease-loss fencing plus restart/ownership tests; delivery pending | not started | Tasks/voice owner |
| Operations / CI `01a047fe-ed81-7602-a512-f2838156225b` | `9fe848ae84ca808533dceb1c8a43779abe1e221a` landed on `origin/main`; CI 33164764500 and deploy 33165012869 passed. Its temporary worktree removal is owned by another task and is excluded from evidence until complete | validated live | Ops owner / release coordinator review |
| Acceptance `01a04800-f64c-7732-9cba-e67ea05842a4` | `codex/aibrain-e2e-security-acceptance` authorized from `d381ccf836516f91464f20225403996e7e8158d1`; first unit limited to fail-closed harness/contracts/evidence manifest; delivery pending | not started | Acceptance owner |

## Dirty-change conversion ledger

The 64 tracked modifications in `AiBrain-today-integration` remain untouched.
They are source material, not an integration branch.

| Dirty source | Auditable destination | State | Required gate |
| --- | --- | --- | --- |
| `package.json`, `package-lock.json`, `src/artifacts/store.test.ts` | I3b / F1 `c1c084910a32b357274c7e0a844c57e7a126bd3e`; exact blob-for-blob extraction by Files owner | validated locally | Integrate into candidate and rerun artifact slice plus typecheck on integrated SHA |
| `contracts/aibrain/v1/ui-backend.schema.json` | Separate contract-only unit owned by Threads/Projects/Knowledge after K1; do not mix with ACL architecture | implemented | Add representative project regression with instructions/sources/memory/sharing; strict AJV examples and contract verification |
| `tests/integration/publication-routes.integration.test.ts` | Separate Files test-fixture unit; environment thresholds only | implemented | Prove production 20%/byte defaults unchanged and test restores environment; rerun publication slice |
| `src/settings/server-service.ts` demo feature policy | Return to Auth/UI/settings owner; do not port as-is | implemented | Direct positive/negative server-side policy tests and explicit decision on demo/company-QA behavior |
| `next-env.d.ts` | Generated path churn; excluded | not started | Regenerate naturally on candidate; never use it as a feature commit |
| 57 PNG snapshots | Hold for UI/settings owner | implemented | Resolve settings-load error, regenerate deterministically, review every matrix diff and run visual/a11y gate |

## Active risks and blocks

1. `today-integration` is not a releasable unit: it combines two merge commits
   with uncommitted contract, runtime-policy, test-fixture and snapshot changes.
2. The demo shortcut in `featurePolicyForUser` changes product behavior and has
   no direct test in the inspected diff. It must return to the settings/auth
   owner or arrive with an explicit acceptance case.
3. The UI contract schema was stale relative to the merged project model. Its
   repair is plausible but needs strict-schema/example validation on the exact
   integration SHA.
4. Disabling disk thresholds is appropriate only inside an isolated test
   fixture. The production defaults in the readiness and publication paths
   must remain unchanged and must be asserted.
5. The 57 image changes are generated evidence, not proof by themselves. Dark
   captures change 84%-99% of pixels and `preferences-dark` currently records
   `No se ha podido cargar toda la configuración`; accepting it would bless a
   degraded state as the expected baseline.
6. The current public health payload proves process and dependencies are ready,
   but does not independently return the running Git SHA.
7. `next-env.d.ts` only switches to `.next/dev/types` after a dev invocation;
   it is generated path churn and is not an integration unit.
8. `origin/main` advanced during the audit through an operations commit and the
   automatic workflow deployed it successfully. It is recorded as a separate
   ops baseline, never as acceptance of pending workstreams.
9. Master readback reported that login exposed `data-installation="company-qa"`.
   Acceptance must re-check whether this is an intended non-secret installation
   marker or a QA surface that must be removed; it is not accepted merely
   because login works.
10. The Knowledge owner diagnosed that shared-project access can open other
    users' snapshots before membership/email filtering. K1 is P0 and must prove
    the unauthorized path performs zero foreign-store reads.
11. Runtime R1's two timed integration tests have not passed in a quiet runner;
    their contention-timeouts are not release evidence.

## Next integration gate

The first feature-bearing candidate may be created only after all workstream
handoffs are recorded. Before that, I3 is converted as follows:

1. K1 ACL pre-retrieval alone; schema remains a later contract-only unit;
2. I3b `server-only` dependency plus the missing artifact-store test mock is
   accepted as a candidate unit but not yet integrated;
3. I6 runtime reconnect ownership only after its two timed integration tests
   pass in a quiet runner;
4. receive and review Auth and UI commits before opening a release candidate;
5. publication test fixture thresholds, with production defaults unchanged;
6. demo feature policy returned to its owner;
7. snapshots held for visual review.
