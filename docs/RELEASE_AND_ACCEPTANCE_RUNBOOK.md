# AiBrain release and acceptance runbook

This runbook is for the exclusive release coordinator. It does not authorize a
merge, push or deploy. Execute the mutation sections only after all workstream
commits are handed off and the master task explicitly opens the corresponding
gate.

## 1. Freeze and preserve inputs

1. Fetch without pruning and record `origin/main` full SHA.
2. Record every worktree path, branch, HEAD and porcelain status.
3. Record every received workstream branch, commit, merge-base and diffstat in
   [the execution board](PROJECT_EXECUTION_BOARD.md).
4. Stop if any handoff branch is dirty, its base is ambiguous, or its commit is
   not reachable from the named branch.
5. Do not reset, clean, rebase, delete worktrees or force-push. Preserve the
   original `codex/aibrain-integrated-qa` checkout and the dirty
   `AiBrain-today-integration` worktree.

Evidence packet fields:

```text
captured_at_utc=
origin_main_sha=
integration_branch=
integration_sha=
integration_tree=
worktree_status_artifact=
handoff_shas=
```

## 2. Build the integration in small units

Create the final integration branch from the recorded `origin/main`, never from
the stale local `main`. For each unit:

1. inspect `git show --stat --summary <sha>` and the full diff;
2. run a no-commit conflict probe or reviewed normal merge/cherry-pick only when
   its gate is authorized;
3. return feature conflicts to the owning workstream; the release coordinator
   resolves only release/docs conflicts or mechanical combinations approved by
   both owners;
4. run the smallest relevant tests;
5. record resulting SHA, diff, test command, exit status and artifact path;
6. commit the unit before beginning the next one.

The observed `today-integration` changes must be split. Do not commit its 57
snapshots with schema, dependency, settings or publication-test changes.

## 3. Local gates without suite contention

Run slices sequentially while other workstreams are active. Candidate commands
must be selected from the actual diff; the minimum release slices are:

```bash
npm run contracts:verify
npx vitest run tests/contract/aibrain-http-contract.test.ts
npx vitest run tests/unit/release-manager.test.ts
npx vitest run tests/integration/multi-user-worker-acceptance.integration.test.ts
npm run infra:validate
```

For the currently dirty `today-integration` fixups, use separate commands:

```bash
npx vitest run src/artifacts/store.test.ts
npx vitest run tests/integration/publication-routes.integration.test.ts
npx vitest run src/app/api/settings/route.test.ts src/settings/preferences-store.test.ts
```

The schema needs an AJV validation of every `x-examples` entry and at least one
representative `WorkbenchProject` containing instructions, sources, memory and
sharing. The demo feature-policy shortcut needs a direct owner-supplied test;
route mocks alone do not validate it.

Coordinate the full suite with the master task. Run it once on the fixed
candidate, sequentially with build and visual/a11y gates; do not overlap heavy
suites from separate worktrees.

## 4. Pre-merge release review

Before changing `main`, capture:

```text
candidate_sha=
candidate_tree=
origin_main_before=
commits_origin_main_to_candidate=
diffstat_origin_main_to_candidate=
git_diff_check=
targeted_tests=
full_suite=
visual_a11y=
rollback_previous_revision=
rollback_previous_app_digest=
rollback_previous_gateway_digest=
```

Verify [the definition of done](DEFINITION_OF_DONE.md) has no mandatory local
row below `validated locally`. Confirm the previous release, its exact inputs,
images and data remain present. A green health endpoint alone is insufficient.

## 5. Merge, push and CI gate

Only the release coordinator performs these actions, after authorization:

1. update remote refs and abort if `origin/main` changed;
2. integrate the candidate with a normal, reviewable commit or an approved
   fast-forward policy; never force-push;
3. push the exact reviewed `main` SHA once;
4. verify the GitHub `Backend CI` run is for that exact SHA;
5. require all four jobs: quality, filesystem/restart E2E, real document matrix
   and clean immutable container builds;
6. if CI fails, do not deploy and do not weaken a gate merely to obtain green.

The deployment workflow in
[`.github/workflows/deploy-arnall.yml`](../.github/workflows/deploy-arnall.yml)
accepts only a successful push CI on current `main` and archives the tested SHA
through the restricted gateway.

## 6. Immutable deployment readback

The deploy job must log `ARNALL_DEPLOY_OK revision=<candidate-full-sha>`. Retain
the job URL and sanitized lines containing:

- full revision;
- app and gateway registry digests;
- release-manager terminal phase;
- no superseded-revision skip.

On the host, read back without exposing secrets:

1. current and previous revision from private release state;
2. current app and gateway image digests;
3. `org.opencontainers.image.revision` for each running image;
4. running container IDs, health and restart counts;
5. hashes of active non-secret Compose/config inputs.

All current values must equal the candidate. Then capture HTTP 200 JSON from
`/api/health/live` and `/api/health/ready`. Every required readiness check and
component must pass. The public payload currently omits revision, so it cannot
replace host release-state and OCI-label readback.

## 7. Restart and product acceptance

Restart only the AiBrain installation through the reviewed operational path.
After readiness returns, repeat the exact release-state, digest, label, health
and restart-count readback.

Using David and Arnau's already provisioned real identities, without recording
credentials:

1. verify each user reaches only their own workspace;
2. create or select a private project/thread for each user;
3. run one real Codex turn for each and record thread ID, runtime turn ID,
   first-text time, terminal time and persisted terminal state;
4. keep one thread active while the other user works to detect mixing;
5. refresh/reconnect and verify the exact messages persist;
6. attempt one unauthorized cross-user read/action and record the expected
   denial plus audit event;
7. perform one approved bounded real action, then read its final URL, artifact
   hash or publication receipt from the controlling store;
8. correlate structured logs/audit with installation, user, thread, turn and
   release SHA.

Redact credentials, tokens, cookies, private prompts and customer document
contents. IDs may be stored only where the evidence packet is private.

## 8. Rollback rehearsal and return

Follow [RELEASES.md](RELEASES.md) and use only `previous` from durable release
state. Do not rebuild the previous release and do not delete the candidate.

1. capture candidate B state and a verified backup;
2. execute the reviewed rollback command for Arnall;
3. require previous A digests and OCI revision to match durable state;
4. require all services healthy with bounded restart counts;
5. read back the same two users and their pre-rollback persisted state;
6. run the minimum login/read turn smoke appropriate to A;
7. re-promote the unchanged candidate B through the reviewed path;
8. repeat immutable readback, restart health and the critical two-user checks.

Stop in maintenance and follow [BACKUP_RESTORE.md](BACKUP_RESTORE.md) if either
side fails health, identity or data checks. Never delete release directories,
images, volumes, journals or backups during the rehearsal.

## 9. Current baseline evidence, not candidate acceptance

At 2026-08-28 12:55 Europe/Madrid:

- `origin/main`: `9fe848ae84ca808533dceb1c8a43779abe1e221a`;
- the one-commit delta from `390bbb06…` changes only the Arnall deploy gateway
  and adds its contract test;
- [Backend CI 33164764500](https://github.com/arnautxu/AiBrain/actions/runs/33164764500) passed all four jobs for `9fe848ae…`;
- [Deploy 33165012869](https://github.com/arnautxu/AiBrain/actions/runs/33165012869) logged `ARNALL_DEPLOY_OK` for `9fe848ae…`;
- current app digest: `sha256:671d7f652efcec9133099790fca6fec036b77ae28a3ff3f4d0271dae00855c9f`;
- current gateway digest: `sha256:926117c1caa82e4b212d7ab5cadeaf722de1edb7ca1ac44f7f4f2f18431c0c09`;
- post-deploy process start: `2026-08-28T10:54:16.471Z`; live and ready returned HTTP 200, 33.97% disk free and all required checks/components `OK`;
- the prior fully green and deployed baseline was `390bbb06c1dac491b89b3c2a133713c6439584bb`;
- [Backend CI 33157502708](https://github.com/arnautxu/AiBrain/actions/runs/33157502708): success, four jobs;
- [Deploy 33157794229](https://github.com/arnautxu/AiBrain/actions/runs/33157794229): success and `ARNALL_DEPLOY_OK` for that SHA;
- app digest logged: `sha256:59c402d472ddf7f21208141f435b9f62b70d4ff0f205dea57be7bac2d69399fa`;
- gateway digest logged: `sha256:6b8ead9665c05cbc1a09b7d546b1bdd04a5c99b6c8f539d2b9836ba83bc02775`;
- live and ready returned HTTP 200; readiness reported 35.97% disk free and
  all storage/toolchain checks passing;
- root redirected to `/login` with HTTP 307;
- this is the pre-integration baseline only. It does not validate the pending
  work-parity merge, dirty fixups, future workstream handoffs or final rollback.
