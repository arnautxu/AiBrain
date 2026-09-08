# Shared company context standard, version 1

Every installation uses the same information architecture. Only identity and
company information vary. The canonical template is
`src/users/company-context-standard.ts`; a customer seed supplies facts, never
permissions. Arnall's versioned seed contains only public/product information
and explicitly unknown internal details. Private customer content stays out of
the product repository.

## Layers and storage

- Trusted product behavior is loaded by `internal-agent-context.ts`. All
  installations, including ones without a custom instruction file, receive the
  same bounded, read-only retrieval guidance with their configured context root.
- Six numbered summaries plus `KNOWLEDGE_INDEX.md` stay small. They share the
  existing 12,000-character snapshot budget with employee context and memory.
- Detailed Markdown belongs in `knowledge/{company,organization,goals,processes,
  tools,systems,app,communication,automations,projects,support,sources,pending}`.
  These documents are not automatically injected. The worker uses its existing
  file-reading/search capability within the authorized mount, guided by the index.
  No new external search service or thread-level dynamic tool is required.
- All content in this root is company-visible. Department folders are not ACLs.
  Private/department/project content uses existing authorized document roots;
  backups, drafts containing private information, secrets and administration
  details remain outside the common context mount. This change grants no new root.

Each detailed document carries a stable company-scoped ID, standard version,
revision, status, audience, owner, source and verification/review fields.
`pending` explicitly means unconfirmed. Product guides are marked as product
evidence; their text never proves an installation capability is available.

## New installations and seed replay

`company-context:seed` and `users:provision` build the same 23-document layout
even without a company-specific seed. A seed overlays facts onto the common
layout. Legacy seed paths are mapped to their canonical knowledge locations.
`PERMISSIONS.md` is rejected in content seeds and remains system-managed.
Existing files, contents and modes are never replaced by provisioning. Legacy
empty knowledge folders remain compatible. Historical installations require a
reviewed content migration; deploying new application code alone does not
upgrade their content or indices.

## Reviewed update of an existing installation

1. Use the installation's real config to export a new private bundle:
   `npm run company-context:export -- /absolute/new/private/bundle`.
2. Review that bundle against current content; retain verified customer facts,
   edit dated installation facts only with evidence, and keep unknowns explicit.
3. Create a `0700` revision directory outside the shared context root, inside
   the installation's private backup boundary. Ensure no other content writer
   is active. Do not run publication from an employee worker.
4. Dry-run `python3 scripts/update-company-context.py --root ROOT --source BUNDLE
   --revisions PRIVATE_REVISIONS`. Record the fingerprint and review changes.
5. Run the same command with `--apply --expected FINGERPRINT`. It rechecks both
   input inventories, saves originals and receipt privately, writes atomic files,
   preserves policy and unrelated files, and verifies all resulting hashes.
6. Record the revision ID. A retry with a new dry-run is a no-op. For rollback,
   use `--root ROOT --revisions PRIVATE_REVISIONS --rollback REVISION`, inspect
   the result, then add `--apply`. The operator tool rejects unknown intervening
   edits and can restore a partially applied known revision. Empty new folders
   may remain; restored file inventory must match exactly.

This is a controlled operator migration with atomic files, not a transactional
database or a general-purpose concurrent editor. Originals and the receipt are
durable before the first write. An interrupted update must be recovered before
another publication. Do not treat an interrupted result as success.

## Acceptance and maintenance

Tests verify identical layouts for unrelated companies, no customer leakage in
generic templates, seed replay preserving content/modes, details excluded from
automatic snapshots, authorized full reads, traversal/foreign-installation
rejection, and backup/conflict/rollback behavior. Live acceptance must separately
prove an authenticated turn reads the detailed file and accurately reports a
pending business fact. Existing user/tenant isolation must remain intact.

Employee corrections are proposals for an accountable content owner. A source
and verification date accompany approved updates. Provisioning never silently
accepts a chat message as company truth. Keep superseded revisions outside the
normal knowledge root; update the index when adding approved documents.

Code/CI/image publication/deployment and live content acceptance are separate
gates. The 2026-09-08 implementation is not itself evidence of live deployment.
