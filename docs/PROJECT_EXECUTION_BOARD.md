# AiBrain project execution board

Last evidence refresh: 2026-08-28 12:43 Europe/Madrid.

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
| Fetched remote baseline | validated locally | `origin/main=390bbb06c1dac491b89b3c2a133713c6439584bb`; inspected with `git fetch --all --tags` | Re-fetch immediately before integration |
| Original integrated checkout preserved | validated locally | `/Users/davidliria/Documents/AiBrain`, branch `codex/aibrain-integrated-qa`, HEAD `8d2616657fa16a55b001a133dfee7b6bbba739e2`, clean, two commits ahead of its remote | Do not merge, rebase, reset or clean this checkout |
| Today integration checkout preserved | validated locally | `/Users/davidliria/Documents/AiBrain-today-integration`, branch `codex/aibrain-today-integration`, HEAD `d381ccf836516f91464f20225403996e7e8158d1`, 64 tracked modifications | Keep all 7 text changes and 57 snapshots until their owner and tests resolve them |
| Release-coordination worktree | validated locally | `/Users/davidliria/Documents/AiBrain-release-coordination`, branch `codex/aibrain-release-coordination`, base `390bbb06c1dac491b89b3c2a133713c6439584bb`; governance unit `0ae213e195b84a47e64463a4f1ac07ac7417f99d`; `git diff --check` and local-link inspection passed | Keep local; no push |
| Current `main` CI | validated live | [Backend CI run 33157502708](https://github.com/arnautxu/AiBrain/actions/runs/33157502708), four jobs green for SHA `390bbb06…` | Repeat for the future integrated SHA |
| Current Arnall deployment | validated live | [Deploy run 33157794229](https://github.com/arnautxu/AiBrain/actions/runs/33157794229) logged `ARNALL_DEPLOY_OK revision=390bbb06…`; [live](https://arnall.graphikai.com/api/health/live) and [ready](https://arnall.graphikai.com/api/health/ready) returned HTTP 200 | Public health does not expose revision; retain deploy-log and host release-state readback for final acceptance |

## Integration units

No unit below is authorized for push or deployment by this board.

| Unit | Contents and ownership | State | Evidence inspected | Next gate |
| --- | --- | --- | --- | --- |
| G0 | Governance documents only; release coordinator | validated locally | Commit `0ae213e195b84a47e64463a4f1ac07ac7417f99d`; this file, [definition of done](DEFINITION_OF_DONE.md), and [release runbook](RELEASE_AND_ACCEPTANCE_RUNBOOK.md); clean diff check and existing local targets | Keep local; do not push |
| I1 | Arnau UI refinement | implemented | Source `c2bece6`; merge `d77f239` in `today-integration`; merge touches `turn-activity`, component test and conversation E2E | Rebase-free reconstruction or reviewed merge on the future integration branch, then focal UI tests |
| I2 | Full work-parity branch | implemented | `codex/aibrain-work-parity` at `d388380`; merge `d381ccf` resolved conflicts in `package.json`, lockfile and filesystem store files | Validate conflict resolutions and run contract/unit/integration slices on exact merge |
| I3 | Today post-merge text fixes | implemented | Uncommitted schema expansion, explicit `server-only` dependency, artifact test mock, demo feature policy, publication disk-threshold fixture | Return demo-policy ownership; validate schema and test-only changes separately; do not bundle snapshots |
| I4 | Today regenerated visual baselines | implemented | 57 modified PNGs: 47 visual-matrix, 6 capabilities, 4 review | Visual owner must show deterministic command, reviewed diffs and exact passing matrix before acceptance |
| I5 | UI, runtime, auth, knowledge, files, tools, connectors, tasks/voice, ops and acceptance deliveries | not started | No branch/commit handoffs recorded in this task at this refresh | Record every received branch, base, SHA, diff and owner before conflict analysis |
| R1 | Final integration into `main` | not started | No release-candidate SHA exists | All dependencies received; local slices and coordinated full suite green; rollback inputs fixed |
| R2 | Immutable Arnall deploy and acceptance | not started | Current live baseline is `390bbb06…`, not the future candidate | CI green, deployment readback, restart, two-user acceptance and rollback rehearsal |

## Workstream handoff ledger

| Workstream | Received branch / SHA | State | Conflict owner |
| --- | --- | --- | --- |
| UI | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; branch/commit delivery pending | not started | UI owner |
| Runtime / streaming | None recorded | not started | Runtime owner |
| Auth / permissions | Base authorized: `d381ccf836516f91464f20225403996e7e8158d1`; proposed replacement of `AIBRAIN_USAGE_ADMIN_USER_IDS`; branch/commit delivery pending | not started | Auth owner |
| Knowledge | None recorded | not started | Knowledge owner |
| Files / artifacts | None recorded | not started | Files owner |
| Tools / browser | None recorded | not started | Tools owner |
| Connectors | None recorded | not started | Connectors owner |
| Tasks / voice | None recorded | not started | Tasks/voice owner |
| Operations / CI | `codex/aibrain-ci-reliability` observed at base `390bbb06…`; no commit handoff received | not started | Ops owner |
| Acceptance | None recorded | not started | Acceptance owner |

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
5. The 57 image changes are generated evidence, not proof by themselves.
6. The current public health payload proves process and dependencies are ready,
   but does not independently return the running Git SHA.

## Next integration gate

The first feature-bearing candidate may be created only after all workstream
handoffs are recorded. Before that, the safe next unit is I3 split into:

1. schema plus schema validation;
2. `server-only` dependency plus the missing artifact-store test mock;
3. publication test fixture thresholds, with production defaults unchanged;
4. demo feature policy returned to its owner;
5. snapshots held for visual review.
