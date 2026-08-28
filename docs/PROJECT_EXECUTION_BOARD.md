# AiBrain project execution board

Last evidence refresh: 2026-08-28 12:55 Europe/Madrid.

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
| Release-coordination worktree | validated locally | `/Users/davidliria/Documents/AiBrain-release-coordination`, branch `codex/aibrain-release-coordination`, base `390bbb06c1dac491b89b3c2a133713c6439584bb`, HEAD `80f69234f832850eec7144a546de0c9934ee8fd6`; governance unit `0ae213e195b84a47e64463a4f1ac07ac7417f99d`; clean diff check and local-link inspection | Keep local and reconcile the one-commit main delta only at an authorized integration gate |
| Current `main` CI | validated live | [Backend CI run 33164764500](https://github.com/arnautxu/AiBrain/actions/runs/33164764500) passed all four jobs for `9fe848ae84ca808533dceb1c8a43779abe1e221a` | Baseline only; repeat for the future integrated SHA |
| Last fully validated CI baseline | validated live | [Backend CI run 33157502708](https://github.com/arnautxu/AiBrain/actions/runs/33157502708), four jobs green for SHA `390bbb06…` | Historical baseline only; it is no longer current `main` |
| Current Arnall deployment | validated live | [Deploy run 33165012869](https://github.com/arnautxu/AiBrain/actions/runs/33165012869) logged `ARNALL_DEPLOY_OK revision=9fe848ae…`; app digest `sha256:671d7f65…`, gateway digest `sha256:926117c1…`; [live](https://arnall.graphikai.com/api/health/live) and [ready](https://arnall.graphikai.com/api/health/ready) returned HTTP 200 with all checks/components `OK` | Public health does not expose revision; this is ops-baseline health, not functional acceptance |

## Integration units

No unit below is authorized for push or deployment by this board.

| Unit | Contents and ownership | State | Evidence inspected | Next gate |
| --- | --- | --- | --- | --- |
| G0 | Governance documents only; release coordinator | validated locally | Commit `0ae213e195b84a47e64463a4f1ac07ac7417f99d`; this file, [definition of done](DEFINITION_OF_DONE.md), and [release runbook](RELEASE_AND_ACCEPTANCE_RUNBOOK.md); clean diff check and existing local targets | Keep local; do not push |
| I1 | Arnau UI refinement | implemented | Source `c2bece6`; merge `d77f239` in `today-integration`; merge touches `turn-activity`, component test and conversation E2E | Rebase-free reconstruction or reviewed merge on the future integration branch, then focal UI tests |
| I2 | Full work-parity branch | implemented | `codex/aibrain-work-parity` at `d388380`; merge `d381ccf` resolved conflicts in `package.json`, lockfile and filesystem store files | Validate conflict resolutions and run contract/unit/integration slices on exact merge |
| I3 | Today post-merge text fixes | implemented | Uncommitted schema expansion, explicit `server-only` dependency, artifact test mock, demo feature policy, publication disk-threshold fixture, plus generated `next-env.d.ts` path churn | Return demo-policy ownership; validate schema and test-only changes separately; exclude generated `next-env.d.ts`; do not bundle snapshots |
| I4 | Today regenerated visual baselines | implemented | 57 modified PNGs: 47 visual-matrix, 6 capabilities, 4 review; dimensions unchanged; pixel-change range 1.92%-99.75%; inspected `preferences-dark` captures a settings-load error | Blocked from integration until visual/settings owners explain the error state, provide deterministic commands, review diffs and pass the exact matrix |
| I5 | UI, runtime, auth, knowledge, files, tools, connectors, tasks/voice, ops and acceptance deliveries | not started | No branch/commit handoffs recorded in this task at this refresh | Record every received branch, base, SHA, diff and owner before conflict analysis |
| R1 | Final integration into `main` | not started | No release-candidate SHA exists | All dependencies received; local slices and coordinated full suite green; rollback inputs fixed |
| R2 | Immutable Arnall deploy and acceptance | not started | Current live baseline is `390bbb06…`, not the future candidate | CI green, deployment readback, restart, two-user acceptance and rollback rehearsal |

## Workstream handoff ledger

| Workstream | Received branch / SHA | State | Conflict owner |
| --- | --- | --- | --- |
| UI | `codex/aibrain-ui-functional-parity` worktree created clean at authorized base `d381ccf836516f91464f20225403996e7e8158d1`; commit delivery pending | not started | UI owner |
| Runtime / streaming | `codex/aibrain-runtime` worktree created clean at authorized base `d381ccf836516f91464f20225403996e7e8158d1`; commit delivery pending | not started | Runtime owner |
| Auth / permissions | `codex/aibrain-auth-security` created at authorized base `d381ccf836516f91464f20225403996e7e8158d1`; 9 working-tree entries observed; proposed replacement of `AIBRAIN_USAGE_ADMIN_USER_IDS`; no commit delivery yet | not started | Auth owner |
| Knowledge | None recorded | not started | Knowledge owner |
| Files / artifacts | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; first unit limited to direct `server-only` dependency/lockfile and artifact-store test mock; delivery pending | not started | Files owner |
| Tools / browser | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; B1 limited to non-retry/indeterminate mutation outcome and evidence tied to audit/approval; delivery pending | not started | Tools owner |
| Connectors | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; fail-closed server-only registry/credential-reference core proposed; delivery pending | not started | Connectors owner |
| Tasks / voice | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; T1 limited to fail-closed lease-loss fencing plus restart/ownership tests; delivery pending | not started | Tasks/voice owner |
| Operations / CI | Commit `9fe848ae84ca808533dceb1c8a43779abe1e221a` (`fix(deploy): make Arnall retries self-cleaning`) landed on `origin/main`; CI 33164764500 and deploy 33165012869 passed | validated live | Ops owner / release coordinator review |
| Acceptance | `codex/aibrain-e2e-security-acceptance` authorized from `d381ccf836516f91464f20225403996e7e8158d1`; first unit limited to fail-closed harness/contracts/evidence manifest; delivery pending | not started | Acceptance owner |

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

## Next integration gate

The first feature-bearing candidate may be created only after all workstream
handoffs are recorded. Before that, the safe next unit is I3 split into:

1. schema plus schema validation;
2. `server-only` dependency plus the missing artifact-store test mock;
3. publication test fixture thresholds, with production defaults unchanged;
4. demo feature policy returned to its owner;
5. snapshots held for visual review.
