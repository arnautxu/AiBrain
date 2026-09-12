# Company knowledge generation candidate — 2026-09-12

This candidate implements bounded hierarchical reduction, scheduling and a Codex
App Server adapter. The user selected the existing Codex connection on 2026-09-12.
It is not an enabled generation service. No real model generation was performed,
credential created, company document ingested, source grant changed or installation
deployed at the initial candidate. Subsequent host validation is recorded below;
real-document acceptance remains pending.

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
The Codex adapter pins `gpt-5.6-luna`, a 256 KiB serialized request, a 64 KiB
result and a 90-second total process deadline. It disables transport and stream
retries. This is a byte/time/attempt budget, not an exact token or euro ceiling.

State lives under `<knowledge-root>/generation-runtime/` in owner-only files,
bound to installation identity. Symlinks and foreign state are rejected. The
aggregate report contains counts and fixed status names, not source paths,
document text, credentials or raw exceptions. `preview=True` rechecks permissions
without creating scheduler state or calling the model.

The `seconds` limit bounds admission of another job, not interruption of an
already running adapter. Host wiring must enforce a per-request deadline and an
external process deadline with whole-process-group cleanup. An expired execution
lease is blocked as unknown, never silently repeated. The supplied systemd service
has a 360-second outer deadline, whole-control-group termination and a 1 GiB memory
limit. No systemd timer is installed or enabled by this candidate.

## Existing Codex connection

`knowledge-codex-adapter.py` starts a fresh pinned Codex 0.153.4 App Server per
step. `account/login/start` uses `chatgptAuthTokens` in memory, taking only the
current access token and account ID from the explicitly selected employee's
existing login. The auth file is opened read-only without following symlinks;
ownership, private mode, account binding and at least 120 seconds remaining
validity are required. The refresh token and ID token are never passed on. The
employee's normal runtime remains responsible for renewal. Expired/missing auth,
server refresh requests or uncertain outcomes stop the job; this adapter never
automatically resets it or performs a second login.

The Linux `bwrap` child gets a new user/PID/mount context, a minimal filesystem,
an empty in-memory home, system libraries, certificates, the pinned executable
and the public model catalog. It receives neither employee/source directories
nor host daemon sockets. Environment variables are cleared. Its thread and turn
have no environments, dynamic tools, capability roots or employee instructions.
The shared `knowledge-codex-config.py` disables tool and skill surfaces, analytics,
history and credential persistence. Source data is only turn input. All server
requests, foreign thread/turn events, tool items and unexpected memory citations
fail closed. This must be exercised under the actual host's namespace policy
before activation; the Mac protocol probe alone does not validate Linux mounts.

The host entry point `knowledge-generation-run.py --config <private-config>`
defaults to permission preview and does not read authentication or launch Codex.
`--execute` is the explicit generation entry point. The root-owned, mode-0600
configuration has exactly these fields (replace placeholders during authorized
installation; this example is not an active grant):

```json
{
  "schemaVersion": 1,
  "manifest": "/etc/aibrain/INSTALLATION/rdp/sync.json",
  "bindings": "/etc/aibrain/INSTALLATION/knowledge-bindings.json",
  "policy": "/etc/aibrain/INSTALLATION/knowledge-generation-policy.json",
  "codexBinary": "/usr/local/lib/aibrain/codex-0.153.4",
  "employeeId": "SELECTED_EMPLOYEE",
  "chatgptAccountId": "SELECTED_ACCOUNT",
  "maxSteps": 4,
  "maxDailyCalls": 32,
  "seconds": 240
}
```

The auth path is derived under the manifest's exact data volume and selected
employee; arbitrary auth paths are not accepted. No secrets belong in this config.
The generation policy must pin `codex-0.153.4:gpt-5.6-luna:knowledge-v1` and contain
explicit source-version/job/audience grants with an expiry. Publication alone
does not grant generation. Copying the service/timer templates does not authorize
activation. The timer runs at most once per 15 minutes after the prior invocation,
with jitter; the durable daily budget remains authoritative across restarts.

## Installation and rollback requirements

1. Record the candidate and current host module revisions. Preserve the old code.
2. Quiesce catalogue writers and semantic workers; allow bounded invocations to
   finish. Verify a private backup and rehearse `knowledge-migrate.py` on copies.
3. Migrate the additive `summary_reductions` table in operator and existing
   audience partitions. Existing tables and rows must remain unchanged.
4. Install the worker and hierarchy module together, plus updated catalogue,
   policy, migration, scheduler, Codex config/adapter and generation runner modules.
   Install the exact native Codex 0.153.4 binary in a root-owned directory and
   ensure host `bwrap`/user namespaces work. Do not copy only the new worker.
5. Bind the user-selected existing Codex account and reviewed source grants.
   Verify the Linux child cannot read host/employee/source files and that its home
   disappears on termination. Do not reuse an employee conversation.
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

Observed on the development Mac: 243 tests, 11 skips, no test failures. Skipped
host/format checks and native Linux isolation remain gates for CI/the deployment
host. Fixtures are fictional. These tests establish mechanics and provenance,
not model correctness on customer documents.

### Linux deployment validation

The first Arnall host smoke test exposed a mount-time permission failure: after
selecting UID 65534, bwrap could not traverse the host's private binary/catalog
directories. The adapter now passes already-open descriptors through
`--ro-bind-data`, with explicit read/execute modes. It does not broaden host
directory permissions. The corrected host smoke test ran the exact Codex 0.153.4
binary as UID 65534, wrote to its disposable home, and verified that host data and
employee home directories were absent. Service-level and model-quality acceptance
are separate gates. No actual credential or customer document was used for this
filesystem smoke test.

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
