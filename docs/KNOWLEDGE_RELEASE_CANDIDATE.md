# Company knowledge application candidate

This change adds scoped indexed file search/read and source-table calculations to
the existing company-file tools, plus administrator review/correction in the Memory
panel. Responses retain source versions, citations and partial-coverage warnings.
Review changes derived knowledge and preserves history; Windows originals remain
read-only. Installing these modules does not enable a model provider.

## Local validation

The application source was validated with generated Codex 0.149.1 contracts,
typecheck, lint, a production Next.js build, automation-worker build and static
Docker/Compose/release-shell checks. The final application suite passed 1,135 tests
with nine skips; four HTTP/restart E2E and 58 browser E2E tests passed. The opt-in
real App Server browser case was skipped. Knowledge tests passed on Linux without
running the suite as root. These fixture-based results do not establish live
employee or semantic acceptance.

The review GET/POST endpoints are registered in the versioned HTTP contract, with
scope, record/citation, correction and error response schemas. Contract tests
reject missing source versions and distinguish an unavailable index from an empty
list. Schema validation does not grant source permissions; server-side access
checks remain authoritative.

Local Node was 24.14.0; GitHub CI pins 24.18.1. The initial constrained local run
could not bind loopback sockets or resolve npm, so the required fixtures ran as a
normal user with that access. No root CI execution was used. Dependency audits
reported no high/critical findings and one moderate sanitize-html advisory on
2.17.5, also present in the base revision; dependencies were not upgraded here.

## Release and live gates

Obtain Backend CI for the exact published revision, publish matching immutable
images, deploy through the protected release workflow, and verify SHA/digests and
readiness separately from authenticated behavior. Exercise search/read/calculation
and review/correction with two users, denied scopes, revoked roles and stale
revisions. Retain restoration and rollback evidence privately.

Full source coverage, automatic employee profiles, semantic summaries/insights,
a governed model adapter and complete recovery/replication acceptance remain
separate requirements. A green build, healthy container or app-UID socket call
cannot establish them. Private operational evidence is excluded from this public
branch and its history; all committed document fixtures are fictional.
