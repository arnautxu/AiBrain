# Source-backed document summaries

Status: source-backed summary protocol and durable executor implementation.
No model adapter or scheduled provider execution is enabled by these modules alone.
Deployment requires current authorization, an accepted adapter and real-document
semantic evaluation. Keep installation readbacks private.

## Contract

`knowledge-summary.py` separates source preparation, section drafting and final
synthesis. It never executes document text, grants access, calls a provider or
confirms its own claims. A generated summary is a proposal for review.

1. Resolve the exact source against the current source-to-audience bindings and
   check the existing scope marker. Unpublished sources are rejected. The operator
   CLI opens only that partition. Current employee access must still be resolved
   server-side before this protocol is exposed through the app.
2. `prepare` produces a content-addressed job bound to source SHA-256 and the whole
   structured extraction hash. All nonempty text and table values become located
   units, split at 3,000 characters and grouped into approximately 24,000-character
   parts. Blank-only blocks are omitted. Extractor warnings remain attached.
3. A semantic model reads each part as untrusted data and supplies up to eight
   claims, including relevant conditions, exceptions and uncertainty. Every claim
   has one to three exact source quotes tied to unit IDs in that part. The host
   verifies quote location/version, not whether a paraphrase logically follows.
4. Part drafts persist in SQLite and can be resumed. An identical retry is safe;
   a changed retry is rejected. No partial summary is published as complete.
5. Final synthesis supplies up to ten claims, each referencing already submitted
   part claims. All parts must be submitted. Up to twenty distinct source quotes
   accompany the resulting record. The full synthesis reference mapping remains
   in the job for audit. A source or extraction change requires a new plan.
6. The resulting summary uses the existing proposal/review record store. Retrieval
   rechecks scope, current source version and verification age. It discloses part
   counts, extraction warnings and proposal/review status. Rejection/deletion is
   not undone by retrying.

Full extraction coverage is distinct from complete understanding of the original.
OCR may miss text; images may have no textual representation; saved spreadsheet
values may be stale; legacy formats may be unsupported. Those limitations must
remain visible in generated answers. Cited quotes are evidence for human review,
not proof that model claims are correct. Numeric insights should use the explicit
calculation tool instead of guessed arithmetic.

## Operator requests

Use a private mode-0600 request file in a root-owned mode-0700 directory. Output
must be a new file in a private directory; it contains document data and must not
be committed to Git or copied to another audience. Examples below are fictional.

Prepare:

```json
{"operation":"prepare","source":"Y:\\Approved\\example.txt"}
```

Submit a part, using the real returned job/part/unit IDs:

```json
{"operation":"part","source":"Y:\\Approved\\example.txt","jobId":"<plan-sha256>","partId":"1","claims":[{"text":"The fictional document describes a weekly review.","citations":[{"unitId":"1","quote":"Review each week"}]}]}
```

Finalize after all parts, using zero-based claim indices:

```json
{"operation":"finalize","source":"Y:\\Approved\\example.txt","jobId":"<plan-sha256>","claims":[{"text":"The fictional process includes weekly review.","references":[{"partId":"1","claimIndex":0}]}]}
```

Invocation after deployment of the candidate:

```sh
python3 /usr/local/lib/aibrain/knowledge/knowledge-summary.py --manifest /etc/aibrain/company-qa/rdp/server-files.json --bindings /etc/aibrain/company-qa/rdp/knowledge-bindings.json --request /absolute/private/request.json --output /absolute/private/new-response.json
```

The CLI only prints operation/output metadata. Reading or forwarding the resulting
file requires current source and audience authorization. Keep source content and
operational acceptance evidence in private operator storage.

## Installation and unfinished integration

Before using the new reader, quiesce inventory and review writers, let the current
bounded inventory invocation finish and verify a private backup. Preserve previous
code, rehearse migrations on copies, install the candidate and migrate the operator
and existing partition schemas using the checked migration helper,
then restart only the knowledge broker and resume the timer. Do not restart an
inventory invocation merely because an observation times out. The app image and
Windows files/configuration do not need to change for this host migration.

The review UI and actor binding are implemented in the local candidate; see
`KNOWLEDGE_REVIEW.md`. A resumable executor core now implements one model step per
call, as described below. The host current-policy adapter is also implemented.
Still required: a concrete governed model adapter and host scheduler, real-document semantic evaluation,
app release and authenticated chat acceptance. No provider or employee permission is implied
by customer text, a prepared plan or a successful unit test. The current operator
CLI is not an employee-facing mutation endpoint.

## Durable semantic executor

`knowledge-summary-worker.py` runs against exactly one already authorized
partition. It does not configure a provider, create a credential, scan for jobs,
prepare an unapproved document or activate a service. A trusted caller enqueues
an existing approved plan and supplies a pinned model identity, a current-policy
callback and a model adapter. Generated records remain proposals.

The callback resolves current generation permission, source publication and the
restored-reader gate before opening this partition, and revalidates them for each
job. The executor calls it before content access, immediately before dispatch and
again before saving. Source SHA/extraction checks are repeated by the summary
protocol. The concrete `GenerationPolicy` below provides this callback and opens
the authorized store. Service wiring is pending; permissive callbacks are only
used in isolated executor tests and must not become a production default.

Each call executes at most one unfinished part or the final synthesis. The model
receives source data separately from fixed instructions, exact citation rules and
extraction warnings. Input is limited to 256 KiB and output to 64 KiB. Large final
syntheses stop with `MODEL_INPUT_TOO_LARGE`; they require hierarchical synthesis,
not truncation or a partial summary mislabeled as complete.

The adapter contract is `generate(request, request_key, timeout_seconds)`. It must
enforce the supplied 90-second timeout, output limit and a tool-free generation
context. A stable request key includes installation, audience, job, model identity
and stage. No provider call was made to validate this contract. A future service
also needs an external process/runtime deadline; a Python callback alone cannot
interrupt a stuck adapter.

`summary_execution` persists model binding, stage, attempts, lease, retry time and
a fixed error code. A 120-second lease prevents concurrent dispatch; SQLite's
writer lock is released during model work. Only an adapter's `NotDispatched`
exception, proving no request was sent, permits retry: 60 seconds, then 300 seconds,
with three attempts maximum per step. Other provider exceptions and expired leases
block as `MODEL_OUTCOME_UNKNOWN`; they never trigger blind repeat calls. No raw
exception text, source text or credential is saved in queue errors. Reconciliation
of uncertain provider outcomes needs a provider-specific operator procedure before
that blocked work can resume.

The result, part/checkpoint and final summary/coverage are committed atomically.
Nested catalogue writes use savepoints so an inner operation cannot commit its
parent's work. A process crash leaves either the durable completed step or the
unresolved lease; it cannot publish a summary without its progress checkpoint.
Lost permission, expired lease, invalid quotation or source changes discard the
result. The executor has no confirm/review capability.

Installation must migrate `summary_execution` alongside the existing summary and
review tables. Do not copy only the executor into a live installation or enable a
timer before its provider/policy adapters and cost/concurrency limits are accepted.

## Pinned CLI isolation probe

Run this offline probe explicitly; it uses a loopback fictional endpoint and no
real credential or provider generation:

```sh
python3 scripts/probe-knowledge-codex-isolation.py --codex-bin /absolute/path/to/codex-0.149.1 --model gpt-5.4
```

The model argument selects metadata for a fictional request only. It does not
change production model selection. Exit 2 means the model-only precondition is
unproven/failed, including a missing request or metadata fallback. Even exit 0
would prove only this request's advertised tool set, not OS isolation or live
semantic acceptance.

The 2026-09-03 macOS run with Codex 0.149.1 observed `update_plan`,
`request_user_input`, `apply_patch` and `view_image`. It had no metadata fallback,
so that direct CLI configuration does not satisfy the model-only requirement. Separate child HOME and
CODEX_HOME removed the earlier skills-context warning. No existing home changed.

The probe was informed by official [non-interactive execution documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
They document ephemeral runs, schema output and feature/image-tool settings;
the captured pinned-runtime request is the acceptance evidence. Do not infer
tool removal from configuration flags alone or upgrade the production runtime
just to make this probe pass.

## Host generation policy

`knowledge-generation-policy.py` supplies `GenerationPolicy.run_step(job_id,
adapter)`. It consumes a trusted loaded installation manifest and two private,
regular, root-owned JSON files: current publication bindings and a generation
policy. Every authorization rereads those files. Unknown keys, foreign installation
or connection IDs, duplicate grants, naive expiry timestamps and oversized config
files are rejected. The root must be canonical. A disabled, expired or ungranted
job is denied before partition access.

The generation policy has this exact shape (fictional placeholders):

```json
{
  "schemaVersion": 1,
  "installationId": "example",
  "connectionId": "example",
  "enabled": false,
  "modelKey": "reviewed-model-adapter-v1",
  "expiresAt": "2026-09-04T00:00:00Z",
  "grants": [{
    "jobId": "<64 lowercase hex characters from the approved plan>",
    "source": "Y:\\Approved\\example.txt",
    "sha256": "<64 lowercase hex characters from the approved source version>",
    "audience": {"scope": "company", "scopeId": null}
  }]
}
```

A grant binds an existing job, exact source SHA, source path and audience. The
adapter's `model_key` must match the policy; changes during a step invalidate its
permission. Current publication resolution and scope markers must still permit
the source. The restored-reader gate is checked before opening the database.
Operator freshness/version is checked independently of the partition, so a stale
published copy cannot override an operator revocation. The job's stored source
and SHA must match the grant before its plan is read. A source/extraction change
requires a new plan and an explicitly corresponding grant.

This is a host operator authorization, not an employee-role endpoint. It creates
no policy or grants and cannot broaden publication. Its model adapter must run in
a dedicated context with enforced tool and filesystem isolation. The local Codex
contracts expose ephemeral threads and structured final output, but those fields
alone do not establish a model-only execution boundary. No existing employee
conversation, worker home or credential was reused for semantic execution in this
phase. Model adapter, process isolation and scheduler acceptance remain pending.

The operator must provision a current generation policy before execution. This
adapter does not create authorization. Tests use fictional grants and sources, substituting only
the fixture's root ownership and deployed scope-marker setup. Separate tests use
the unchanged ownership guard and verify denied scopes, restore gates, revocation
before dispatch/during generation, source versions and pinned model identity.
