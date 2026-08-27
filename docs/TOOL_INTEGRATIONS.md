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
employee gate for the authenticated user. Only a user listed in
`AIBRAIN_USAGE_ADMIN_USER_IDS` may change an installation gate. The chat and
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

## Adding a connector

1. Define typed read and mutation operations.
2. Add a credential-provider adapter and redacted health response.
3. Map every operation to `PERMISSIONS.md` and approval behavior.
4. Add synthetic provider fixtures, contract tests and cross-user isolation
   tests.
5. Add a runbook for OAuth/login, rotation, revocation and degraded mode.
6. Validate with a dedicated QA account before enabling real company data.
