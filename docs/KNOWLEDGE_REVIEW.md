# Review of source-backed knowledge

Status: review/correction API, UI and isolated host socket implementation. Deployment
requires the installation and authenticated acceptance gates below. Operational
readbacks and customer records belong in private operator storage.

## Authority and boundaries

The Memory panel exposes document-derived knowledge separately from conversational
memory. Only enabled local workspace administrators with current consultation
permission may list review records. The selected project must be accessible via
the existing shared-access resolver. Readable company, department, project and own
private scopes come from the same server-side document-permission resolver used
for runtime turns. A role never grants access to foreign private data.

Confirm/reject/withdraw/correct additionally requires publication capability and, for a
shared project, an editable project membership. These actions update derived
knowledge only; they do not require or grant write access to Windows originals.
The browser supplies a record ID, expected revision, decision, scope, project and
connection. Corrections additionally supply bounded replacement text and a required
reason; they cannot replace entity identity, citations, actor or source permissions. The session supplies actor and installation. Extra actor or permission
fields are rejected. Same-origin enforcement and a bounded body precede mutation.

The app server is trusted to resolve that authority. Its UID alone may use the
separate root-owned review socket. The broker does not trust document/model text
or expose arbitrary commands. It independently validates the current source-to-
scope binding, marker, restoration gate and source state. Runtime model tools keep
using the read-only knowledge socket and have no review operation registered.

## Behavior

- Pending records expose confirm/reject; confirmed records can be withdrawn. Both
  can be corrected by a reviewer with current publication capability. A correction
  creates a confirmed replacement and supersedes the previous record atomically;
  its original content, citations, reviewer, reason and revision remain in history.
- Source quotations, locations, version hashes and competing records remain visible.
- Confirmation supersedes competing confirmed records using the existing ledger.
- Every review records actor, revision, action and time. Rejected/deleted records
  are not silently recreated by replaying their original proposal.
- Expected revisions prevent a second browser from overwriting a newer decision.
  On a conflict, refresh before making another decision.
- A source change, revocation, deletion, expired verification or gated restore
  prevents confirmation. The operator database is checked before publication can
  update the audience copy.
- Lists are paginated and bounded in bytes. Unavailable indexes are not shown as
  empty inventories. Closing/reopening discards the previous view.

The UI shows recent events for currently available pending/confirmed records; it
is not the complete archive viewer. The correction editor is implemented in this
local candidate; delegated non-admin reviewer roles and automatic semantic summary
generation remain pending. A human correction retains its existing citations and
is a reviewed interpretation, not an automated proof that the wording follows
from those citations. Changed source evidence needs a new sourced proposal.

## Host installation order

Before schema changes, quiesce both inventory and review writers and verify a
private backup. The `knowledge-migrate.py` helper checks unchanged existing schema
and row counts, rejects unexpected preexisting tables and supports repeated runs.
It does not coordinate running writers itself. Rehearse on database copies first.

1. Complete source-schema migration for the preceding summary candidate and the
   additive `knowledge_corrections` table in every operator/partition catalogue.
   The table links replacement to original record/revision, reviewer and reason;
   verified SQLite backups preserve both statements and their dependency history.
   Retain previous host code. Pause the knowledge inventory timer and observe its
   actual service invocation until terminal; quiesce the review service if installed.
   Do not restart an inventory invocation on a polling timeout.
2. Create the installation's `locks/knowledge-review` directory under the existing
   app data volume: root owner, configured app GID, mode 0750. Its parent ownership
   and unrelated Docker directories must not be relaxed. The service's declared
   write path must exist before systemd starts it.
3. Install the reviewed Python modules and
   `aibrain-arnall-knowledge-review.service`. This fixed unit is for company-qa;
   other installations need their own bound unit/paths. Root-generated descriptor
   mode is 0440; socket is root:app-GID 0660. Catalogue roots remain private.
4. Migrate existing partitions before enabling any reader that expects new tables.
   Start only the new review daemon; resume the inventory timer. Existing app,
   RDP mirror and Windows configuration do not need to restart or change.
5. Perform readback with the actual app UID plus a wrong-peer negative check.
   Validate real review records and actions only within their authorized scope.
6. Deploy the app through separate Backend CI, GHCR publication, deployment and
   authenticated live acceptance gates. Verify two users, denied scopes, revoked
   roles, source changes and stale revision handling on the actual served SHA.

Rollback stops/disables only the new review service and restores the prior app
release if it was deployed. Keep its durable knowledge/event history and schema;
never erase records or backups to roll back the UI. Existing read-only knowledge
retrieval can continue independently.

## Correction contract and current evidence

`correct` is a human review operation on the separate review socket. It is not
a runtime/model tool. Current session role, publication capability, authorized
scope, source/version freshness and the restored-reader gate still apply. The
expected revision prevents concurrent overwrites; the entire replacement, source
dependencies, superseded records and history linkage commit in one transaction.
A database failure rolls all of them back.

The replacement keeps the original entity, topic, kind and citations. It requires
a changed statement of at most 8,000 characters and a reason of at most 1,000.
HTTP and socket request bodies are capped at 64 KiB to support those bounded
Unicode fields. Response validation binds the new ID to the exact old ID/revision
and checks the saved text and reason. No actor or citation override is accepted.

An extractor cannot revive the corrected statement on the same source versions
by changing a transport key, quote length/order or label. A genuinely new source
version may justify a fresh unconfirmed proposal. Future source change/revocation
also invalidates the replacement normally. Explicit human corrections remain
reviewed actions; the protection does not prevent an authorized reviewer from
reconsidering a previous correction.

The UI retains drafts on errors, discards them on an explicit refresh/context
change, requires a changed statement and reason before saving, and shows the
previous content/reason in the confirmed record's history. Browser tests use only
fictional data. Host installation and real-user correction acceptance must be recorded separately
for each deployed revision; fictional tests do not establish either gate.
