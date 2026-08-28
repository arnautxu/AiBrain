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
authorization snapshot, persists the exact approval receipt through
`FileApprovalStore`, revalidates binding/version/scopes/health immediately
before the call, and uses the durable approval lock for execution. No route
returns `credentialRef`, a receipt, an authorization snapshot, tool arguments,
or provider credentials. Prepare returns a safe descriptor and a normal visible
`ApprovalItem`; execution reconstructs server-only state from durable stores.

## Evidence

| Check | Result |
| --- | --- |
| Focused route and fake-transport integration test | `npx vitest run src/connectors/connectors.test.ts src/app/api/connectors/codex-managed-app/action/route.test.ts`: 18 passed |
| Focused lint and whitespace validation | ESLint passed; `git diff --check` passed |
| Type contract validation | `npx tsc --noEmit` passed after correcting two static type errors before commit |

The focused tests inspect HTTP JSON, reject receipt/auth/server/tool/argument
fields from a browser body, persist the normal pending connector record, then
resolve it directly in the store before execution and correlated readback.
They also reject recursively normalized credential keys in static arguments.

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
provider readback has been used. A simulated process crash after a provider
side effect but before `executed` persistence leaves the record approved and
allows a second execution; this is an explicit at-least-once crash-window risk,
not an exactly-once guarantee. It needs an Auth-coordinated state-machine or
provider idempotency expansion. The remaining single Arnall input is one
reviewed `connectors.codexManagedAppAction` manifest for the intended personal
Codex App/MCP connection.
