# Codex MCP connector action acceptance

## Baseline and risk

Baseline `08f3ba41c978e85ee70319709b1c732746ee1664` exposed only
`read-availability`; it had no MCP tool-call mutation, durable connector
approval consumption, or provider readback. Arnall has no reviewed MCP action
manifest or personal OAuth binding, so live reproduction would require an
unauthorised provider side effect and was not attempted.

## Changed behaviour

`codex-managed-app` now has exactly one mutation operation. It is unavailable
unless `connectors.codexManagedAppAction` names one fixed App, MCP server,
tool, static arguments, and correlated readback. The browser cannot select
those fields. The server derives principal and policy, prepares a SHA-256
authorization snapshot, persists the matching approval record only on the
server, revalidates binding/version/scopes/health immediately
before the call, and uses the durable approval lock for execution. No route
returns `credentialRef`, a receipt, an authorization snapshot, tool arguments,
or provider credentials. Prepare returns a safe descriptor and a normal visible
`ApprovalItem`; execution reconstructs server-only state from durable stores.

## Evidence

| Check | Result |
| --- | --- |
| Focused Auth, route and fake-transport integration tests | `npx vitest run src/runtime/approval-store.test.ts src/connectors/connectors.test.ts src/app/api/connectors/codex-managed-app/action/route.test.ts`: 30 passed |
| Focused lint and whitespace validation | ESLint passed; `git diff --check` passed |
| Type contract validation | `npx tsc --noEmit` passed after correcting two static type errors before commit |

The focused tests inspect HTTP JSON, reject receipt/snapshot/auth/server/tool/argument
fields from a browser body, persist the normal pending connector record, then
resolve it directly in the store before execution and correlated readback.
They also reject recursively normalized credential keys in static arguments,
verify a single provider dispatch, and verify that a post-dispatch readback
failure becomes `indeterminate` without a provider replay after restart.

## Before and after

Before, prepare serialised the server receipt and full authorization snapshot
to the browser and no normal pending ApprovalItem existed. After, those remain
server-only and an allowlisted installation can prepare a visible durable
connector pending item, then execute one approved MCP action with independent
readback. Without the manifest or healthy personal binding, Settings stays
hidden and the capability fails closed with a precise code.

## Remaining validation

Implemented and locally validated with fake transport only. Not live-validated:
no Arnall MCP manifest, personal App/OAuth binding, approval-route handoff, or
provider readback has been used. Before dispatch the approval becomes durable
`executing`; an execution/readback failure after dispatch becomes durable
`indeterminate`. A second execute or restart does not call the provider again.
This is at-most-once dispatch, not proof of a provider-side exactly-once
outcome: manual provider recovery/readback and an idempotency capability remain
required. The remaining single Arnall input is one reviewed
`connectors.codexManagedAppAction` manifest for the intended personal Codex
App/MCP connection.

## P0 corrective evidence

Baseline `511bc31297f18ff88a74f4fbb238572934d4a915` had three reproducible
compile errors: nullable execute input in the route, an authorization store
passed into `ConnectorRegistry`, and a missing action constructor argument.
Its authorization store checked only the leaf file, so a symlinked parent could
redirect private snapshots outside `dataRoot`.

The correction wires the store only into action construction, narrows the
execute value, and creates/checks each parent as a real private directory with
canonical containment under `dataRoot` before lock or file access. The focused
corrective validation is `npx tsc --noEmit` plus route/integration tests: 19
passed. It proves symlink rejection on both read and write, and cross-user or
cross-installation isolation. The visible item remains `kind: "command"` for
the current UI contract; the durable `ApprovalRecord.requestType` is
`connector`. No connector-specific UI kind is claimed. Auth C2 resolves
approve/execute only through the server-side locator and marks post-dispatch
uncertainty `indeterminate`; Connector does not retain a crash hook or duplicate
locator execution method.
