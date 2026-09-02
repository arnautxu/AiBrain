# AiBrain operating truth

Last versioned refresh: 2026-08-30. Integration baseline: `origin/main=7e16429689da2de2734d73235cd848d5639667db`.

## Product

AiBrain is one reusable company-brain product for isolated company installations. Arnall is the first real installation and canary, not a customer-specific fork or a disposable pilot. Each installation owns its configuration, branding, identities, company context, secrets, data, browsers, backups and release state. Company context is filesystem-first business data; `PERMISSIONS.md` and server-side identity remain authoritative for access and actions.

The product is useful when employees can keep durable projects, conversations, files and company knowledge, use only authorized tools, approve sensitive effects, and recover work after reconnect or restart without crossing tenant or user boundaries.

## Architecture and release chain

```text
GitHub main SHA
  -> Backend CI run for that exact SHA
  -> Publish GHCR run for the same SHA
  -> immutable app + gateway digests
  -> Deploy Arnall run with three distinct run IDs
  -> restricted client pull by digest
  -> transactional release manager + health/readiness
  -> cleanup limited to validated inactive AiBrain images and legacy release directories
  -> private release, runtime and OCI readbacks
  -> separate authenticated live acceptance
```

The deploy workflow must resolve the successful `Backend CI` push run through GitHub's API. The Publish run ID is not a CI run ID. Readback records Backend CI, Publish and Deploy IDs, the common full SHA and both digests; the host verifies those digests again against release state, running containers and OCI labels. Documentation-only changes do not start Backend CI. A newer `main` revision may cancel a superseded Publish run, but Deploy runs are serialized and are never cancelled mid-deployment.

## Current maturity at the inspected baseline

| Area | Versioned state | Still required before calling it accepted |
| --- | --- | --- |
| Installation and identities | Multi-installation config, Supabase/local identity mapping, isolated users/workers and durable workspace roles are implemented with automated coverage | Real current user roster/roles and authenticated cross-user negative readback on the candidate |
| Workbench and continuity | Projects, threads, library, files, streaming recovery, task center and governed settings are implemented; `faac15c` adds duplicate-safe scheduled-turn recovery and `af2c363` isolates app/automation runtime journals | Candidate restart/long-idle acceptance with persisted terminal state and no mixed turns |
| Memory | Completed turns durably enqueue a minimal per-user extraction job after the terminal response; the offline worker resumes pending jobs after restart, then filters, deduplicates, revisions and retrieves stable preferences, facts and decisions from the employee/project store. The queue does not persist the full prompt. Settings shows the list plus edit/delete controls directly | Authenticated two-user live readback on a future candidate; automatic company-wide promotion remains intentionally disabled |
| Documents and browser | Isolated document preview/publication boundaries and non-interactive, policy-bound browser effects are implemented | One real Arnall browser action without an approval pause and with controlling-system readback; no synthetic substitute |
| Connectors | Credential binding, approvals, at-most-once dispatch and readback contracts are implemented | A reviewed Arnall connector/action manifest, real OAuth/credential binding and provider readback |
| Automations | Durable scheduling, worker packaging, audience/lease/recovery logic and release reconciliation are versioned | Confirm the intended Arnall execution flag and run one bounded real automation acceptance; context text never enables execution |
| Release operations | Immutable GHCR promotion, transactional deploy, bounded cleanup and private readback collectors are implemented | CI, Publish, Deploy and live gates must pass for the same future candidate; rollback-and-return remains a separate exercise |
| Company context | A source-backed, unknown-aware Arnall seed is versioned; nested documents enter the bounded turn snapshot; a server-only per-installation product brief governs identity and capabilities; company/department/project/private files use turn-bound tools | Approved internal Arnall facts, preferences, processes, objectives, brand pack, tools and support ownership; current memberships and external file mounts |

The Hetzner operator host also has a separately verified RDP path to the Arnall
Terminal Server and Database Server. That path is governed by the host-only
`read-only-export` policy documented in
[WINDOWS_RDP_CONNECTION.md](WINDOWS_RDP_CONNECTION.md): inventory, read and
copy-out are allowed; remote create/write/overwrite/delete/move/rename and
arbitrary commands are denied. This is operator connectivity and bounded
copy-out; employees read scoped, imported text through the existing document
tools and never receive the RDP credentials or a Windows session.

The 2026-09-02 operator tool and scheduled importer are documented in
[WINDOWS_DOCUMENT_SYNC.md](WINDOWS_DOCUMENT_SYNC.md). One PDF copy at 08:16
UTC matched Windows/Hetzner SHA-256 and 223219 bytes. A subsequent Windows
policy regression at 08:28 UTC disabled redirection again (effective
DriveMapping=1). The importer preserves that boundary and verified copies.
The user authorized the company-wide audience. At 08:49 UTC a fresh service
run completed all six documents: five new verified transfers and one reused
verified PDF, with no unreadable documents. The complete text snapshot is
published through the existing scoped document tools. An authenticated chat
then read the updated status and a newly copied DOCX, confirming six readable
documents, both folders and the document's actual agreement title.
The service extractor uses an empty `/proc`, because mounting a process
filesystem failed inside the protected systemd namespace. PDF and DOCX
extraction passed under the same service restrictions after this correction.
No Windows policy or customer source file was modified by the tool;
Windows read-only ACL verification remains a separate gate.

On-demand document refresh is implemented through the same scoped search/read
tools and a host-only Unix broker. Requests are bound to the installation and
authorized turn roots, coalesced across callers, and may reuse a successful
check for thirty seconds. Failures retain verified copies with explicit stale
status. See the document-sync runbook for installation and separate host,
application-release and authenticated chat acceptance gates.

The 2026-09-02 resumed-chat incident exposed a local RPC routing deadlock:
a previous turn's usage notification waited for the new turn binding while
blocking the `turn/start` response that supplied it. The candidate correction
routes responses by request ID independently of ordered thread events, retaining
contiguous durable acknowledgements and explicit turn ownership. It also makes
empty company-file searches disclose their limited coverage even after a
successful refresh. See the document-sync runbook for the observed source
boundary and incident evidence; production acceptance remains separate.

No row above is a claim that this documentation branch is published, deployed or accepted live.

## Evidence language

- `implemented`: code or content exists at the named SHA.
- `validated locally`: the exact SHA passed the named local test or contract.
- `CI passed`: Backend CI passed for the exact SHA; it says nothing about image publication or deployment.
- `published`: GHCR returned the two immutable digests for that SHA.
- `deployed`: the client release state, runtime and OCI labels correlate to that SHA and those digests.
- `validated live`: authenticated product behavior was read back on the deployed installation.

Never collapse these states. Health/readiness is operational evidence, not user-level acceptance.

## Durable references

- Product success: [PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md)
- Priorities: [PRIORITIZED_BACKLOG.md](PRIORITIZED_BACKLOG.md)
- Release procedure: [RELEASE_AND_ACCEPTANCE_RUNBOOK.md](RELEASE_AND_ACCEPTANCE_RUNBOOK.md)
- Release mechanics and rollback: [RELEASES.md](RELEASES.md)
- User and context provisioning: [USER_PROVISIONING.md](USER_PROVISIONING.md)
- Trust boundaries: [ARCHITECTURE_AND_TRUST_BOUNDARIES.md](ARCHITECTURE_AND_TRUST_BOUNDARIES.md)
