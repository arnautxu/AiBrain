# AiBrain operating truth

Last versioned refresh: 2026-08-30. Baseline integrated before this change: `origin/main=af2c36388b518feb8fc2cc86eeff7d0302672491`, a descendant that preserves `faac15c`.

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
  -> cleanup limited to superseded AiBrain images
  -> private release, runtime and OCI readbacks
  -> separate authenticated live acceptance
```

The deploy workflow must resolve the successful `Backend CI` push run through GitHub's API. The Publish run ID is not a CI run ID. Readback records Backend CI, Publish and Deploy IDs, the common full SHA and both digests; the host verifies those digests again against release state, running containers and OCI labels.

## Current maturity at the inspected baseline

| Area | Versioned state | Still required before calling it accepted |
| --- | --- | --- |
| Installation and identities | Multi-installation config, Supabase/local identity mapping, isolated users/workers and durable workspace roles are implemented with automated coverage | Real current user roster/roles and authenticated cross-user negative readback on the candidate |
| Workbench and continuity | Projects, threads, library, files, streaming recovery, task center and governed settings are implemented; `faac15c` adds duplicate-safe scheduled-turn recovery and `af2c363` isolates app/automation runtime journals | Candidate restart/long-idle acceptance with persisted terminal state and no mixed turns |
| Documents and browser | Isolated document preview/publication boundaries and non-interactive, policy-bound browser effects are implemented | One real Arnall browser action without an approval pause and with controlling-system readback; no synthetic substitute |
| Connectors | Credential binding, approvals, at-most-once dispatch and readback contracts are implemented | A reviewed Arnall connector/action manifest, real OAuth/credential binding and provider readback |
| Automations | Durable scheduling, worker packaging, audience/lease/recovery logic and release reconciliation are versioned | Confirm the intended Arnall execution flag and run one bounded real automation acceptance; context text never enables execution |
| Release operations | Immutable GHCR promotion, transactional deploy, bounded cleanup and private readback collectors are implemented | CI, Publish, Deploy and live gates must pass for the same future candidate; rollback-and-return remains a separate exercise |
| Company context | A source-backed, unknown-aware Arnall seed is versioned and provisioning creates only missing files | Approved internal Arnall facts, preferences, processes, objectives, brand pack, tools and support ownership |

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
