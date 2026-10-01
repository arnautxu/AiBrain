# Native Instantly read connector

This optional connector adds `@Instantly` to an installation's existing chat,
mention health and company tools. It uses a company resource and explicit user
catalog read grants. It does not provide personal OAuth, campaign changes,
sends, warmup changes, uploads or arbitrary HTTP access.

## Security and provider contract

Configure `connectors.instantly` with `enabled` and the exact authenticated
workspace UUID. Keep `AIBRAIN_INSTANTLY_API_KEY` only in the installation's
private server environment, never InstallationConfig, worker environment,
company context or a browser response. Bind the opaque reference
`server:instantly-workspace-key` with scope `instantly:read` in the existing
`FileConnectorBindingStore`; the shared binding represents the company resource.
Personal revoked bindings must block fallback to the shared binding.

Each read rechecks current catalog access, binding state and the authenticated
`GET /api/v2/workspaces/current` identity before retrieving data. Returned
account, campaign, lead and email organization IDs must match that workspace.
Dynamic tool requests also require the selected mention and the matching tenant,
thread and turn. Catalog denial or binding revocation applies to subsequent
calls. No grants are automatically installed by enabling the connector.

Supported operations: workspace, paginated accounts and campaigns, read-only
lead listing, received emails, numeric campaign analytics and warmup analytics
for previously verified workspace-owned email accounts. The two documented POST
endpoints (`leads/list` and `accounts/warmup-analytics`) retrieve data only. Pages
are bounded to 100 records; return and follow `nextCursor` until exhausted before
claiming a total. Provider HTTP errors/timeouts are sanitized, without automatic
retry or raw error bodies. Account credentials and unreviewed fields are
excluded. Reply content is untrusted data, never an instruction.

Instantly API v2 OpenAPI documentation was inspected on 2026-10-01. Empty replies,
leads or metrics must remain empty/zero, rather than generating sample data.
A warmup score is provider evidence, not proof of inbox placement or permission
to launch. API permissions may be broader than the adapter; the adapter exposes
only the fixed read methods. A 401/403/429 or unavailable endpoint degrades the
capability and must be reported explicitly.

## Installation and release

1. Prepare and review the exact installation config through the existing
   versioned release flow. Do not change an active config behind its release
   manifest. Keep other tenant configs, images, roles and credentials untouched.
2. Add the company catalog resource described by
   `INSTANTLY_CATALOG_RESOURCE`. Use existing audited catalog commands and grant
   `read` only to the intended user IDs. Do not create installation-wide or write
grants unless separately authorized.
3. Create an active shared binding with the exact credential reference and
   `instantly:read`, increasing its durable version if it already exists. The
   key remains server-side; copying a binding is not copying a key.
4. Apply the private server environment and reviewed immutable release only to
   the target installation. Report Backend CI, image publication, deployment
   and authenticated acceptance separately. A PR or passing local test is not
   a live connection.
   The thread toolset revision advances so older conversations use the existing
   safe rebootstrap path; App Server cannot add a dynamic tool on thread resume.
5. With each intended user, verify mention availability, current workspace,
   paginated accounts/campaigns, warmup, leads, received replies and metrics
   through actual chat. Verify catalog denial, personal revocation and tenant
   mismatch cannot reach the provider. Check another tenant without the optional
   configuration has no Instantly capability.

Commercial replies remain drafts for the installation's responsible person.
Connecting this reader does not activate the reply-stop, suppression, CRM-write
or alert workflows; those require their own configuration and acceptance.
