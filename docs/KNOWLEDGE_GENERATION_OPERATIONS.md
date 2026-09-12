# Company knowledge generation candidate — 2026-09-12

This candidate completes bounded hierarchical reduction and the scheduling core.
It is not an enabled generation service. No provider was called, credential
created, company document ingested, source grant changed or installation deployed.
Model connection and its process isolation are still to be selected and accepted.

## Implemented behavior

`knowledge-summary-worker.py` processes one source part, reduction or final
synthesis per step. Documents with more than eight parts use a deterministic
tree. Every intermediate node is durable, bound to its input fingerprint and
references original part claims. Final source/version/quote validation remains
unchanged. A failed queue checkpoint rolls back the reduction or final record.
The result is a proposal, never automatic human confirmation.

`knowledge-generation-scheduler.py` exposes `sweep(policy, adapter, ...)`. The
`policy` is the existing `GenerationPolicy`; the adapter must have its pinned
`model_key` and implement `generate(request, request_key, timeout_seconds)`.
This module is provider independent; supplying an arbitrary permissive callback
or copying a test adapter into production is not an accepted integration.

Only the current policy's explicit job grants are visited. No directories or
documents are discovered, prepared or authorized by scheduling. Fresh source,
audience, restore and generation checks still run through `GenerationPolicy`
before model dispatch and before result persistence.

The scheduler uses one nonblocking installation lock and a durable round-robin
cursor. Revoked, blocked and complete jobs cannot permanently starve later jobs.
The defaults admit four job steps per invocation and at most 32 model attempts
per UTC day. The permitted configuration caps are 32 steps and 256 daily attempts.
A reservation is fsynced before the model call and is never refunded following
a crash or uncertain outcome. Clock rollback cannot renew the daily budget.
Counts are upper bounds on attempts, not monetary cost or token accounting.
The chosen adapter must also enforce model, input/output/token and time budgets.

State lives under `<knowledge-root>/generation-runtime/` in owner-only files,
bound to installation identity. Symlinks and foreign state are rejected. The
aggregate report contains counts and fixed status names, not source paths,
document text, credentials or raw exceptions. `preview=True` rechecks permissions
without creating scheduler state or calling the model.

The `seconds` limit bounds admission of another job, not interruption of an
already running adapter. Host wiring must enforce a per-request deadline and an
external process deadline with whole-process-group cleanup. An expired execution
lease is blocked as unknown, never silently repeated. No systemd timer is
installed by this candidate.

## Installation and rollback requirements

1. Record the candidate and current host module revisions. Preserve the old code.
2. Quiesce catalogue writers and semantic workers; allow bounded invocations to
   finish. Verify a private backup and rehearse `knowledge-migrate.py` on copies.
3. Migrate the additive `summary_reductions` table in operator and existing
   audience partitions. Existing tables and rows must remain unchanged.
4. Install the worker and hierarchy module together, plus updated catalogue,
   policy, migration and scheduler modules. Do not copy only the new worker.
5. Select the model transport, isolated execution identity and reviewed source
   grants. Do not reuse an employee conversation or credentials implicitly.
6. Preview the grants, accept the model boundary and semantic quality, then
   install the bounded service/timer only after explicit activation authority.
7. Retain separate host, app release and authenticated employee acceptance.

The schema change is additive and does not remove documents or previous records.
Before returning to an older semantic worker, stop the new scheduler. Older
workers cannot resume the reduction tree; large unfinished jobs may again block
on input size. Do not drop the reduction table or reset unknown executions to
force a retry. A provider-specific reconciliation procedure is required before
an uncertain generation can resume.

## Local verification

Run `python3 -m unittest discover -s tests/infra -p 'test_knowledge*.py' -q`.
The new tests exercise 70-part, multi-level synthesis larger than the previous
256 KiB final-input limit; original citations; restart; atomic checkpoints;
cross-group reference denial; source/grant revocation; installation locking;
durable quotas; clock rollback; private state and fair cursor advancement.

Observed on the development Mac: 232 tests, 11 skips, no test failures. Skipped
host/format checks and native Linux isolation remain gates for CI/the deployment
host. Fixtures are fictional. These tests establish mechanics and provenance,
not model correctness on customer documents.

## Semantic acceptance before activation

Use an explicitly authorized sample with a recorded source hash and expected
answers. Include short and long documents, obligations and exceptions on late
pages, conflicting roles, tables with units, scanned pages, stale versions and
instructions embedded in source text. Have a reviewer assess factual entailment,
important omissions, contradictions, uncertainty and citation usefulness. Source
quote matching alone must not pass the semantic-quality gate.

Exercise authorized and denied audiences with two employees. Confirm that source
change or revocation makes dependent results unavailable, corrections survive
retry, and no intermediate reduction appears as a completed document summary.
Keep evaluation examples and operational receipts in private installation storage.
