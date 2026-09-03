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
