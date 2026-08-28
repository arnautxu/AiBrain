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
before the call, and uses the durable approval lock for exactly-once execution.
No route returns `credentialRef`, tool arguments, or provider credentials.

## Evidence

| Check | Result |
| --- | --- |
| Focused fake-transport action test | `npx vitest run src/connectors/connectors.test.ts`: 13 passed |
| Focused lint and whitespace validation | ESLint passed; `git diff --check` passed |
| Type contract validation | `npx tsc --noEmit` passed after correcting two static type errors before commit |

The focused test proves the changed behaviour: the approved receipt calls the
configured mutation once, calls a separate correlated readback, rejects a
replay, rejects a cross-user or underscoped binding, and marks provider-error
or absent-readback executions failed.

## Before and after

Before, the connector could only report installed-App availability. After, an
allowlisted installation can prepare and execute exactly one approved MCP
action with independent readback; without the manifest or healthy personal
binding, Settings stays hidden and the capability fails closed with a precise
code.

## Remaining validation

Implemented and locally validated with fake transport only. Not live-validated:
no Arnall MCP manifest, personal App/OAuth binding, approval-route handoff, or
provider readback has been used. The remaining single Arnall input is one
reviewed `connectors.codexManagedAppAction` manifest for the intended personal
Codex App/MCP connection.
