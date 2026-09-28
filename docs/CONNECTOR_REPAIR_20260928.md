# Composio connection repair — 2026-09-28

Arnall has twelve installation-authorized Composio toolkits. Its Outlook uses
Composio too; the four original toolkits have explicit auth-config IDs and the
eight additional toolkits use `on-connect`.

## Verified cause and correction

The provider's `GET /auth_configs/{id}` returns `credentials.scopes` as a string
array. Provisioning accepted only CSV strings, so it created a valid remote
config, rejected its readback, and never persisted the receipt. Further Connect
attempts created duplicates. Accept both documented CSV input and observed array
readback while requiring the exact reviewed scope set. Reject missing, malformed,
expanded or reduced permissions. Before creating, recover only an enabled OAuth2
config with the exact installation/manifest fingerprint name, toolkit and verified
scope set. Existing connected accounts are not deleted or reassigned.

The chat previously presented initial loading and failed catalog requests as an
empty authorized catalog. A first click now opens the panel immediately, with
loading, empty and error states inside it. Results populate the open panel without
a second click; dismissal during loading is respected. Failed requests can be
retried inside the panel. Read-only Composio checks overlap in batches of four,
preserving catalog order, per-user authorization and individual provider failures.
Closing/opening Settings
refreshes the projection after connection changes. Connect failures return to the
product's connector settings and log only a diagnostic code, never credentials or
provider payloads. Catalog and user authorization remain server-side.

## Repair / validation

`scripts/repair-composio-auth-configs.ts --installation=<id>` is read-only without
`--apply`. Applying provisions only the already-reviewed installation manifest;
it neither connects personal accounts nor modifies catalog permissions. It uses
the existing per-installation fingerprint locks/receipts. It verifies auth config
identity and all version-pinned read-tool definitions using the runtime key.
Run through the normal authenticated server egress channel and as the app user.
For a standalone container bundle, alias `server-only` to
`scripts/server-only-stub.mjs` with esbuild. Do not print proxy URLs or API keys.

Validation layers are separate: provisioning/tools, authenticated Connect redirect,
personal OAuth consent, account ACTIVE readback, and a real read tool. The first
two do not establish that an unconnected user has granted access. Existing Gmail,
Calendar and Drive bindings must remain valid. Do not authorize provider consent
or remove existing accounts merely to complete QA.

Local regression coverage includes actual scope-array responses, interrupted
creation/recovery, concurrency, rejected scope drift, user/tenant/callback isolation,
loading-versus-empty chat state, and trusted-origin error redirects. Backend CI,
GHCR publication, deployment and authenticated live acceptance are separate gates.
