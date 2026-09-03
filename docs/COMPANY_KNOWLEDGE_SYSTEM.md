# Company knowledge system

The company library adds a durable private inventory, verified source copies,
located extraction, scoped search, source-backed knowledge and human review.
Windows source paths and permissions remain unchanged. The implementation is a
foundation for company memory; full corpus coverage and semantic quality require
installation-specific acceptance, not just a successful build.

## Layers and boundaries

1. Inventory resumes paginated directory traversal, tracks source versions and
   reports incomplete coverage. Missing entries from an unstable or inaccessible
   listing are never treated as proof of deletion.
2. Ingestion verifies copied bytes and hashes before sandboxed extraction. PDF,
   Office, text and raster OCR retain page, paragraph, sheet/cell or image locators.
   Unsupported formats and parser failures remain explicit.
3. Publication copies only sources mapped by an explicit source-to-audience
   binding. Operator discovery does not grant employee access. Company,
   department, project and private indexes remain separate.
4. Retrieval uses the existing company-file tools for indexed search/read and
   exact decimal calculations over selected source cells. Responses identify
   coverage, versions and freshness; original source checks use the existing
   read-only connection.
5. Derived facts, summaries and insights retain citations and source dependencies.
   Human review/correction is a separate app-server-only socket. Corrections keep
   prior statements and reviewer history; changed or revoked sources invalidate
   dependent knowledge.
6. Lifecycle workers reconcile sources, preserve bounded backups and require fresh
   policy/source reconciliation before restored indexes become readable.

Customer documents are data, never authorization or executable instructions.
Company knowledge and personal conversational memory remain separate. Model
summaries require current job/source/audience authorization and an accepted
isolated adapter; installing schema tables does not enable provider calls.

## Scheduling and resource bounds

The inventory has bounded time/page admission and retains its cursor after
interruption. A path-local failure defers that directory until another invocation
while allowing other folders to proceed. Transport or policy failures retain their
stop conditions. Source contention yields without bypassing the shared lock.

Ingestion preserves approved business-root priority, then stable discovery order.
New small arrivals cannot repeatedly displace older records in the same group.
Byte/time/storage limits and retry cooldowns still determine admission. Per-source
and per-parser failures use fixed codes; raw exception text is not an audit field.

## Native RDP client home

The FreeRDP child receives a private temporary HOME, configuration and cache
directory for its session. Some service contexts omit HOME, and ProtectHome
hides the operator home. The client must not depend on either. The parent environment,
operator home, credentials and pinned endpoint remain unchanged. The directories
are removed with the session, including failed startup. Keep ProtectHome enabled;
validate native startup inside the same service restrictions before installation.

The keyboard pipe and a visible local X window do not prove the remote desktop
has rendered. Before sending Run or paste keys, the client requires three
consecutive nonblank interior frame samples within sixty seconds. The helper
returns only a boolean; it saves no screenshot or OCR text. This prevents input
during a black frame, but does not prove arbitrary desktop/modal readiness.
Failure closes the session without sending those keys and preserves retry bounds.

## Bounded listing session reuse

The inventory reuses one RDP connection for at most three consecutive fixed
listing requests and admits no further request after twenty seconds in that
session. The current request retains its 45-second timeout; startup and cleanup
are additional bounded work. The existing nonblocking source lock remains held
until rotation or batch exit, so other callers receive the existing busy signal.
Every request reloads endpoint, credential and source policy; changes require a
new session, and changes during startup or execution discard the request/result.
Each page has a distinct nonce and private receipt. Transport uncertainty closes
the session without an automatic retry. Confirmed path-local failures retain the
existing per-directory retry cap. Copy/export and employee brokers are unchanged.

The inventory emits only aggregate session/request counts and startup/execution
seconds. These metrics measure listing overhead, not full ingestion throughput.
Before enabling the candidate, compare three authorized listings with three
separate sessions under the same host restrictions; do not print source paths or
entries. Pause the inventory timer, wait for its actual invocation to finish,
preserve previous code, install both knowledge-listing-session.py and its inventory
caller, then resume the timer even if the bounded pilot fails.

## Runbooks

- [Legacy document extraction](KNOWLEDGE_LEGACY_FORMATS.md)
- [Raster OCR](KNOWLEDGE_IMAGES.md)
- [Source-backed summaries and execution policy](KNOWLEDGE_SUMMARIES.md)
- [Human review and corrections](KNOWLEDGE_REVIEW.md)
- [Gated backup recovery](KNOWLEDGE_RECOVERY.md)
- [Application candidate validation](KNOWLEDGE_RELEASE_CANDIDATE.md)

Existing service templates target an example installation and must be checked
against the installation manifest before use. Preserve existing services and
scope bindings. Before schema changes, quiesce all catalogue writers, verify a
private backup and rehearse migrations on copies. Resume scheduling after bounded
installation checks, including failure paths.

## Acceptance and unfinished work

Verify inventory completeness, parser coverage, source hash/provenance, positive
and denied scopes, revocation, corrections and recovery independently. Record
Backend CI, GHCR publication, deployment and authenticated live acceptance as
separate gates for the exact revision. Real employees must be tested, including a
second user denied access to foreign private data.

The model adapter, automatic semantic execution, employee/entity mapping quality,
full corpus processing and off-host recovery acceptance are not established by
this implementation alone. Large summary synthesis currently stops at its bounded
input limit rather than silently truncating; hierarchical synthesis remains an
integration limitation. OCR does not establish visual or table understanding.

Operational inventories, source mappings, backup identifiers, service invocation
IDs and customer acceptance records belong in private operator storage. This
public repository contains code, fictional fixtures and reusable runbooks rather
than customer corpus data or an operational journal.
