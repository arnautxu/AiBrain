# Tool integrations and credentials

Email, CRM, calendars and other company tools are connectors, not Markdown
credentials. Company Markdown files may describe processes, terminology,
owners and safe usage rules, but must never contain passwords, API keys,
OAuth refresh tokens or session cookies.

## Connector model

Each integration has a typed server-side adapter with:

- a stable tool/schema contract exposed to Codex;
- an installation-level or employee-level credential reference;
- minimum OAuth scopes or API permissions;
- server-side permission checks before every read or mutation;
- explicit approval for consequential actions such as sending email or
  modifying CRM records;
- bounded timeouts, retries, rate limits and circuit breaking;
- structured audit events without secret values;
- health and reauthentication states shown in Settings.

Codex receives a tool capability and sanitized results. It never reads the
secret file itself. The browser profile is not a general credential store for
backend connectors.

## Settings catalogue

`GET /api/settings` is the employee-facing source of truth for capabilities
that this installation actually publishes. It currently reports the Codex
runtime, web search, image generation, installed skills, the managed browser
and the document workflow. Runtime health is combined with the live
`/api/runtime/status` response in the UI; a missing runtime/provider is shown as
`not_configured`, never as a connected OAuth account.

Web search, image generation, skills and the managed browser have two durable
enablement gates: an installation gate and a per-employee gate. The effective
state is the intersection of both. `PATCH /api/settings` may change the
employee gate for the authenticated user. Only a durable `workspace-owner` or
`workspace-admin` assignment may change an installation gate. The chat and
browser server paths enforce these gates; hiding a control in the UI is not an
authorization boundary.

The same response exposes effective `PERMISSIONS.md` rules, privacy/isolation
facts, browser network guarantees and notification preferences. Permission
rules and network restrictions are intentionally read-only in this UI.

## Secret storage

For the current dedicated-server architecture, secrets live in root-owned
files outside the repository and outside employee workspaces. They are mounted
read-only only into the connector/runtime process that needs them. Files use
mode `0400` or `0600`, are excluded from backup unless the backup is separately
encrypted, and are rotated per customer.

When the fleet grows, the same credential-provider interface can be backed by
a managed secret store without changing tool contracts or customer data.

Never place secrets in:

- `AGENTS.md`, `PERMISSIONS.md`, company context or memory Markdown;
- git, image layers, Compose YAML or `InstallationConfig`;
- chat messages, logs, audit payloads or generated artifacts;
- another customer's server or a shared browser profile.

## Identity and scope

Use company service credentials only for genuinely shared resources. Use
per-employee OAuth when actions must be attributable to a person. Connector
records bind `installationId`, optional `userId`, provider, scopes and secret
reference. A credential from one installation or employee must fail closed in
all other contexts.

Shared Codex authentication used for the current Arnall QA phase is a temporary
runtime configuration choice; it does not change these connector isolation
rules and should not be reused for customer email or CRM identities.

## Local document generation and preview

PDF, DOCX, PPTX and XLSX creation is a server-local product capability, not a
connector. `aibrain_documents.create` writes a validated, non-empty file below
the authenticated employee's private project workspace and returns only its
relative path, size, hash and private artifact URLs. Google Drive, Dropbox and
other OAuth-backed storage are never consulted unless the employee explicitly
chooses that destination in the current request. A personal OAuth binding from
another employee is neither a fallback nor an eligible shared credential.

Generated Office previews are converted to PDF inside the private document
sandbox. Every converter runs in its own process group with a fixed timeout and
request cancellation. Cancellation, timeout or excessive tool output terminates
the whole process group (including LibreOffice helpers), removes the private work
directory and returns an explicit `cancelled`, `retryable` or `failed` state.
The route never retries an uncertain conversion effect automatically.

Downloads and previews reauthorize installation, employee and project on every
request. Responses are same-origin, bounded, type-validated and `private,
no-store`; the protected API response keeps `X-Frame-Options: DENY` and
`frame-ancestors 'none'`. The browser fetches the PDF with same-origin
credentials, validates type and size, and displays only a revocable local
`blob:` URL. Read-only company/source mounts remain outer sandbox roots and are
not promoted to App Server workspaces, preventing nested workspace discovery
from trying to create `.git` below `/srv/aibrain/source-ro`.

## Arnall Codex MCP action gate

The only implemented mutation path is disabled unless the installation supplies
one reviewed `connectors.codexManagedAppAction` manifest. It must name one
already callable Codex App (`appId`), one fixed MCP `server` and `tool`, static
non-secret arguments, and one fixed readback tool with the configured
correlation field. Browser requests cannot choose any of those values.

The installation parser rejects credential-like keys recursively in static
arguments (including normalized authorization, cookie, password, secret,
access/refresh-token and API-key variants). Credentials belong only to a
binding/provider boundary and are never configuration values.

This is the sole missing Arnall input: one approved action manifest for a
personal Codex App/MCP connection. Its binding needs only `app.installed.read`
and `mcp.tool.call`; the real provider OAuth scopes remain the App owner's
choice and must not be invented here. Until that manifest and personal binding
are present, the UI hides the connector and the API returns
`CODEX_APP_ACTION_NOT_CONFIGURED`.

## P0 authenticated UI consumer

Baseline `9ecc0d8d272add8a16b40e77b2541b9433a43ae1` exposed the safe capability
and action routes but had no browser consumer. A user could not initiate the
allowlisted action, see its pending approval, or review the safe terminal
outcome in the normal thread Activity/Tools surface.

The UI now reads `GET /api/connectors` after authentication and renders the
control only when `codex-managed-app` is `connected` and
`execute-allowlisted-action` is effective. It sends prepare only with the
active thread and current turn IDs, adds the returned normal `ApprovalItem` to
the visible message state, and reuses the approval endpoint. Only `accept`
continues to execute with the exact locator and authorization fingerprint.
Decline and session-wide approval both deny the connector action and never
call execute. A cross-thread descriptor is dropped locally before any request.

The only visible readback is the safe outcome `executed`, `replayed`,
`indeterminate` or `denied` in the existing tool-results panel. The browser
never renders or exports the receipt, authorization snapshot, credential
reference, server, tool, arguments or provider correlation.

Focused client evidence:

```text
npx vitest run tests/unit/codex-managed-app-ui.test.ts \
  tests/component/managed-app-action-control.test.tsx \
  tests/component/turn-review.test.tsx
3 files passed, 10 tests passed
```

The fake-fetch tests cover missing/connected capability gating,
prepare→pending→accept→execute, decline without execute, stale cross-thread
descriptor rejection, indeterminate visibility data and forbidden-field
absence. This is local UI/contract evidence only: no Arnall manifest, binding,
provider action or live readback was used.

### Recovery safety

The pending connector descriptor is retained in a client registry keyed by its
complete thread, turn, item and approval locator. Visiting another thread does
not downgrade the approval into a generic approval: returning to the original
thread retains the same descriptor and fingerprint, and connector approvals
never offer a session-wide permission. The registry is removed only after a
valid terminal response.

Network errors, non-OK responses and malformed approval or execute responses
remain recoverable. They do not set a synthetic `denied` or `accepted` state,
do not call the generic approval path, and allow a retry with the original
descriptor. Focused local evidence is now 4 files and 14 tests, including the
BrainApp registry, Activity rendering and adapter recovery cases.

## Adding a connector

1. Define typed read and mutation operations.
2. Add a credential-provider adapter and redacted health response.
3. Map every operation to `PERMISSIONS.md` and approval behavior.
4. Add synthetic provider fixtures, contract tests and cross-user isolation
   tests.
5. Add a runbook for OAuth/login, rotation, revocation and degraded mode.
6. Validate with a dedicated QA account before enabling real company data.
