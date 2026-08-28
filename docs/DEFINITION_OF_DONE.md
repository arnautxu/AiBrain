# AiBrain definition of done

This definition applies to the release candidate that will be integrated into
`main` and deployed to `https://arnall.graphikai.com`. Historical evidence can
justify a test design, but it cannot mark a new candidate `validated live`.

## Status rules

Use only `not started`, `implemented`, `validated locally`, or `validated live`.
Global done requires every mandatory row below to be `validated live` on the
same immutable Git SHA, except repository-preservation rows that terminate at
`validated locally` by design.

## Repository and integration

| Mandatory acceptance | Current state | Evidence | Required closing evidence |
| --- | --- | --- | --- |
| Remote, branches and worktrees reconciled | validated locally | Inventory in [execution board](PROJECT_EXECUTION_BOARD.md) at `origin/main=9fe848ae…`; the remote advanced once during the audit | Repeat fetch/status/worktree/graph immediately before final integration |
| David and Arnau changes preserved | validated locally | Original `integrated-qa` is clean/ahead 2; `today-integration` retains 64 modifications; no worktree deleted | Final pre-merge status readback showing no dropped commit or working-tree file |
| Small reviewable integration units | implemented | G0 exists; I1-I4 are decomposed on the board | One commit or reviewed merge per unit, with exact diff and owner |
| Release-candidate branch and SHA fixed | not started | No final branch/SHA received | Record branch, base, merge-base, full SHA and tree hash |
| No unresolved conflict or ownership violation | not started | `d381ccf` had four resolved conflicts; final candidate does not exist | `git diff --check`, conflict-resolution review and owner sign-off/readback |

## Automated gates

| Mandatory acceptance | Current state | Evidence | Required closing evidence |
| --- | --- | --- | --- |
| Contracts generated and versioned | validated locally | CI 33164764500 passed `contracts:verify` for current `main=9fe848ae…`; [HTTP catalog](../contracts/aibrain/v1/http-routes.json) and [UI schema](../contracts/aibrain/v1/ui-backend.schema.json) exist | Same gates green on candidate; new routes/types have schemas, examples and tests |
| Typecheck, lint, unit/integration/contract tests | validated live | [CI 33164764500](https://github.com/arnautxu/AiBrain/actions/runs/33164764500) passed for current `main=9fe848ae…` | Repeat on final candidate and retain exact job URL |
| Filesystem/restart E2E | validated live | CI 33164764500 filesystem/restart job passed for current `main=9fe848ae…` | Repeat on final candidate and retain exact job URL |
| Real Office/PDF/text/image matrix | validated live | CI 33164764500 document job passed for current `main=9fe848ae…` | Repeat on final candidate and retain exact job URL |
| Clean immutable container builds and audits | validated live | CI 33164764500 passed clean app/gateway builds and both audits for current `main=9fe848ae…` | Candidate image digests, audits/SBOM/scan evidence and zero unresolved critical findings |
| Visual and accessibility acceptance | not started | Historical work-parity results do not cover the final integration; 57 dirty snapshots are pending review | Deterministic candidate visual/a11y run, reviewed diffs, no unexplained retry |

## Product acceptance

| Mandatory acceptance | Current state | Evidence | Required closing evidence |
| --- | --- | --- | --- |
| Two real provisioned users remain isolated | validated locally | [multi-user acceptance test](../tests/integration/multi-user-worker-acceptance.integration.test.ts) covers two users and four turns; historical live notes exist in [backend progress](AIBRAIN_BACKEND_PROGRESS.md) | On candidate after restart, David and Arnau each read only their own project/thread/files/browser state; cross-user attempts fail with expected status and audit event |
| A real Codex turn completes | validated locally | [worker turn path](../src/runtime/worker-codex-turn.ts) and historical live acceptance are present | Candidate live thread ID, user ID alias, runtime turn ID, terminal status and response readback |
| Streaming is visible and terminal state is exact | validated locally | [chat route](../src/app/api/chat/route.ts), [projection test](../src/workbench/turn-projection-store.test.ts) and historical live traces | Candidate timestamps for first text/terminal event; zero duplicate/error events; persisted message status `complete` |
| State survives application restart | validated locally | Filesystem/restart E2E and durable stores pass on current baseline | Restart exact candidate, then read back the same users/projects/threads/turns and runtime continuity |
| Permissions are server-enforced | validated locally | [permission turn tests](../src/runtime/permission-turn.test.ts), [permission provider tests](../src/permissions/markdown-permission-provider.test.ts) | Candidate allows one authorized operation and denies one unauthorized cross-user or policy-blocked operation, both audited |
| One real action completes | validated locally | Historical browser action is recorded in [backend progress](AIBRAIN_BACKEND_PROGRESS.md); implementation in [browser server service](../src/runtime/browser/server-service.ts) | Candidate performs an approved, bounded action; final URL/artifact/receipt is read back from the controlling store |
| Observability identifies the same user/thread/turn/release | implemented | Health, release state, alerts and usage/audit components exist | Correlated candidate evidence from release state, health, structured logs/audit and persisted turn; no secrets in evidence |

## Release, live and rollback

| Mandatory acceptance | Current state | Evidence | Required closing evidence |
| --- | --- | --- | --- |
| CI-gated immutable deployment | validated live | Deploy [33165012869](https://github.com/arnautxu/AiBrain/actions/runs/33165012869) logged exact current SHA `9fe848ae…` and two immutable digests | Equivalent log and host release-state readback for candidate |
| Live and ready after deployment | validated live | Current [live](https://arnall.graphikai.com/api/health/live) and [ready](https://arnall.graphikai.com/api/health/ready) returned 200 after the `9fe848ae…` deploy; process start `2026-08-28T10:54:16.471Z`, all checks/components `OK` | Candidate post-deploy and post-restart payloads, timestamps and all required checks/components pass |
| Running SHA independently read back | implemented | Deploy log identifies current SHA; public health omits revision | Host `release-state.json` plus running OCI labels/digests equal candidate SHA; retain sanitized output |
| Rollback logic and documentation | validated locally | [release manager tests](../tests/unit/release-manager.test.ts) are in CI; [release documentation](RELEASES.md) defines digest/revision checks and recovery | Candidate/previous state inputs reviewed and local test slice green |
| Rollback exercised on Arnall | not started | No deliberate rollback-and-return evidence for the future candidate | Roll candidate B back to preserved A, read back A health/SHA/data, then re-promote B and repeat all critical health/identity checks |
| Final acceptance after restart | not started | Current baseline health is not candidate product acceptance | Complete every product row after restart on the same candidate SHA |

## Release decision

The release coordinator may declare done only when the evidence packet contains:

1. candidate full SHA and tree hash;
2. exact integration diff and all workstream handoffs;
3. candidate CI run URLs and green job list;
4. immutable app and gateway digests with matching OCI revision;
5. live and ready payloads before and after restart;
6. two-user isolation and real-turn/action evidence;
7. rollback-to-A and return-to-B evidence;
8. final `main`, remote and worktree readback.
