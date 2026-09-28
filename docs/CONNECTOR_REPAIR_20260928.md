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

## Google managed OAuth scope correction

On September 28, Google's account chooser reproduced “Esta aplicación está
bloqueada” for Composio's managed Docs client with `documents.readonly`. The
same client/account reached Google's consent screen with `documents`. No consent
was granted during that comparison. Managed OAuth verification is scope-specific;
successfully issuing a redirect or reading an existing grant cannot accept a new
Google authorization.

David explicitly authorized using Composio's standard Google permissions. The
snapshot `config/connector-profiles/composio-google-standard-scopes-20260928.json`
pins the provider defaults for Gmail, Calendar, Drive, Sheets, Docs and YouTube.
These OAuth grants include write permissions and, for Gmail, profile/contact
permissions. They are not read-only grants. The existing optional profile filename
is retained for compatibility: its version-pinned **execution tools** remain
read-only, while its Google OAuth scopes use the approved standard sets.
Never silently adopt later changes to provider defaults.

`scripts/migrate-google-composio-scopes.ts` is an operator migration, dry-run by
default. Both `--installation=<id>` and `--public-url=<url>` must match. It checks
managed config identities, existing scopes and current defaults before mutation.
With `--apply`, it snapshots the installation/old scopes privately, PATCHes only
scopes, reads each back, and emits a validated candidate installation file. Failed
provider updates attempt rollback with readback. The operator must compare the
current installation to the snapshot before installing the candidate and preserve
the backup. Use the normal server egress and app user as for the repair script.

Preserve all existing auth-config IDs, including resolved on-connect IDs, in the
candidate: changing IDs would invalidate existing personal account bindings.
The migration does not revoke, authorize or replace personal accounts. Existing
grants keep their original scopes until the user reconnects. No change is made
to catalog permissions, pinned read tools, tenant/user enforcement or write-tool
denial. Confirm provider consent screens separately from personal grants and
post-authorization reads. The final consent belongs to each account owner.

Provider references:
- https://docs.composio.dev/docs/authentication/controlling-scopes
- https://docs.composio.dev/docs/changelog/2026/01/14
