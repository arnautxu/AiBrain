# Connected apps — feedback round 02, 4 September 2026

Status: **IMPLEMENTED / locally validated with synthetic provider; real provider acceptance BLOCKED-NOT-TESTED**. No deployment or account creation performed. Source base: `8c5bc4cd95b15b1fd066a0ae4647d7a7b2bb6d4f` (includes Arnau's latest image changes).

## Observed cause, not an inferred fix

Read-only inspection of the actual Arnall app container found `companySlug=arnall`, no `connectors` block, and all these environment-variable presence checks false: `COMPOSIO_API_KEY`, `AIBRAIN_COMPOSIO_API_KEY`, the three `AIBRAIN_GOOGLE_*` OAuth variables and the three `AIBRAIN_MICROSOFT_*` OAuth variables. No values or credentials were displayed/copied. This configuration produces no authorized connector cards. Existing Gmail/Outlook code does not provision the external OAuth registrations. A successful build cannot supply these missing dependencies.

## Delivered path

Installation-reviewed toolkit manifest → authorized personal card in Settings → hosted Connect link → browser consent → authenticated callback consuming durable one-use state → upstream ACTIVE account readback (installation-derived user + toolkit + exact auth config) → versioned personal binding → live status and @ selection → `aibrain_connected_apps.list_tools/read` → exact account and version-pinned tool execution → local block followed by provider revoke and delete.

The integration uses the existing binding store, state store, catalog enforcement, worker dynamic-tool dispatch and Settings projection. No new dependencies, database, native app or shared OAuth. OAuth tokens stay in Composio's managed secret storage; only the project API key goes in the existing host runtime secret environment, and only opaque account references are stored locally (0600). No provider API key, account reference or OAuth tokens are exposed in cards/mentions/tool definitions. Native Gmail/Outlook retain AES-256-GCM token storage and refresh.

Each tool invocation rechecks user policy, local binding and upstream owner/toolkit/auth-config/status. Unknown tools are denied before execution. Read-tool names and dated versions must be reviewed in installation config; neither tool-name heuristics nor an upstream catalog entry grant write authority. No MCP gateway exposing all tools, generic proxy, sends, purchases, account provisioning or credential fallback was added. Provider descriptions/results are untrusted data. A per-user/toolkit durable operation lock serializes calls with disconnect/callback. Failed upstream revoke leaves local status revoked and supports retry. Expired upstream status offers reconnect.

Native Gmail and Outlook retain their existing paths. Settings now explains an empty catalogue, uses provider-neutral read-permission text, offers revoke retries/reconnection in failure states, and reports a pending provider revocation instead of implying it completed. `brain-app.tsx` already opens Connectors on `?settings=connectors`; no composer/branding edits are required.

## Provider matrix — observed Arnall state

| Provider | Implemented | Configured in Arnall | Connected | Tested |
|---|---|---|---|---|
| Gmail | Existing native OAuth/refresh + search/read; new managed adapter can use reviewed Gmail toolkit | No | Not established | Existing tests + synthetic lifecycle; real BLOCKED-NOT-TESTED |
| Outlook | Existing tenant-specific native OAuth/refresh + search/read; new managed adapter can use reviewed Outlook toolkit | No | Not established | Synthetic controls; real BLOCKED-NOT-TESTED |
| Google Calendar | New generic hosted OAuth, per-user binding, live tool discovery and reviewed read execution; no hardcoded provider preset | No | Not established | Generic lifecycle only; toolkit-specific BLOCKED-NOT-TESTED |
| Google Drive | Same generic adapter; no hardcoded provider preset | No | Not established | Generic lifecycle only; toolkit-specific BLOCKED-NOT-TESTED |
| GitHub | Same generic adapter; no hardcoded provider preset | No | Not established | Synthetic GitHub-shaped responses only; real BLOCKED-NOT-TESTED |
| CRM | Same extension contract, only after the company identifies and authorizes its CRM/tool permissions | No CRM assumed | Not established | BLOCKED-NOT-TESTED |

No matrix cell claims provider usability merely because a file exists. Native/managed write actions are outside this read-only delivery; existing governed action infrastructure remains unchanged.

## Exact external setup / owners

David/company owner: identify an existing **GraphikAI/Arnall-owned** Composio project, or explicitly approve creation of a new account (question asked in this task; no creation performed). Never use Albert's Melso project, OAuth, keys or connected accounts. Each employee completes their own consent. GraphikAI installation administrator/release operator: install the project key as `AIBRAIN_COMPOSIO_API_KEY` in the existing `AIBRAIN_RUNTIME_ENV_FILE` secret store consumed by app/worker, and supply reviewed manifest entries in `connectors.composio.toolkits`.

Each entry has exactly:

- `slug`: real Composio toolkit slug, validated against the selected project's auth config;
- `label`: human app name;
- `authConfigId`: real enabled OAuth2 config ID (`ac_…`) from that project;
- `scopes`: reviewed minimum OAuth scopes configured in that auth config (not tokens);
- `readTools`: list of `{slug, version}` with actual provider tool slug and a fixed dated version (`YYYYMMDD_NN`), reviewed as read-only.

No invented auth IDs/tool versions or automatic auth-config creation. Admin must review provider auth-config scopes before publishing the manifest; local `scopes` is a reviewed declaration, **not an independent proof of the provider's actual granted scopes**. Require a new consent after changing scope requirements. Configure `restrict_to_following_tools` on Composio as defense in depth. Tool metadata is fetched live and must match the toolkit and pinned version; execution is pinned as well. A removed toolkit removes its managed catalog resource/rules; user/group/role deny still wins. Use a new chat after the initial rollout because Codex dynamic-tool definitions are fixed at thread creation.

Managed callback allowlist:

`https://arnall.graphikai.com/api/connectors/composio/<actual-toolkit-slug>/callback`

The provider preserves the opaque `state` query parameter. It must return `status` and `connected_account_id`. Browser must retain its Arnall authenticated session; if login expired, sign in and restart Connect. Callback validates the authenticated tenant/user as well as one-use state; it does not accept a user ID from the query. Composio refreshes OAuth tokens; non-ACTIVE readback blocks use and requires consent again. App/worker need server HTTPS access to `backend.composio.dev`; browser needs the hosted consent domain and chosen OAuth provider. Release operator validates egress without relaxing unrelated rules.

Native alternatives (no Composio required):

| Provider | Required configuration | Exact Arnall redirect | Minimum scope plan |
|---|---|---|---|
| Gmail | `connectors.gmail.enabled=true`; `AIBRAIN_GOOGLE_CLIENT_ID`, `AIBRAIN_GOOGLE_CLIENT_SECRET`, `AIBRAIN_GOOGLE_OAUTH_ENCRYPTION_KEY` (32 random bytes/base64) | `https://arnall.graphikai.com/api/connectors/gmail/oauth/callback` | `https://www.googleapis.com/auth/gmail.readonly` |
| Outlook | `connectors.outlook.enabled=true`, exact Entra `tenantId`; `AIBRAIN_MICROSOFT_CLIENT_ID`, `AIBRAIN_MICROSOFT_CLIENT_SECRET`, `AIBRAIN_MICROSOFT_OAUTH_ENCRYPTION_KEY` (32 random bytes/base64) | `https://arnall.graphikai.com/api/connectors/outlook/oauth/callback` | delegated `User.Read`, `Mail.Read`, plus `offline_access` |
| Calendar managed | Own enabled OAuth config, reviewed tool slugs/versions | managed callback above | start with `calendar.events.readonly`, add `calendar.calendarlist.readonly` only for listing calendars |
| Drive managed | Own enabled OAuth config, reviewed tool slugs/versions | managed callback above | `drive.metadata.readonly` for metadata only; `drive.readonly` only if reading file content is authorized |
| GitHub managed | Own enabled OAuth config, reviewed tool slugs/versions | managed callback above | `read:user` for profile; private repository access needs a separate permissions review (classic `repo` is broader than read-only); do not silently grant it |

See `docs/GMAIL_OAUTH.md` and `docs/OUTLOOK_OAUTH.md` for native provisioning and Microsoft's external-consent revocation limitation.

Composio public pricing checked 4 September 2026: Free $0, 100K monthly tool calls, unlimited connected accounts, 3 team members; up to 20K of the free calls via Composio-managed apps. Pro $29/month and usage pricing; no paid plan authorized or activated. Pricing source: https://composio.dev/pricing . This is published pricing, not evidence of an existing project or contracted allowance.

## Melso comparison — complete relevant mechanisms read

Read-only reference checkout SHA `7c667dd1a41fee4bc2b5172649527cf9f4d26771`:

- `server/internal/handler/integrations_composio.go`: authenticated management, public signed-state callback, toolkit/connection routes.
- `server/internal/integrations/composio/service.go`, `state.go`, `dispatch.go`: all service/state/dispatch source read; dynamic toolkit/auth-config discovery, automatic managed/DCR config provisioning, signed five-minute state, account owner+auth-config verification, local connection mirror, revoke/delete and per-task MCP overlay.
- `server/pkg/composio/README.md`, `connected_accounts.go`, `tools.go`, `auth_configs.go`; SDK wire protocol and exact-account deterministic execution.
- `packages/views/settings/components/composio-tab.tsx`, `packages/core/composio/queries.ts`: complete settings/query implementation; live catalog search, consent redirect, callback feedback, connection invalidation and disconnect.

Melso exposes every provisionable toolkit, can provision auth configs automatically and creates an MCP overlay from the agent owner's active connections intersected with its allowlist. Its current shared-agent model can let an authorized invoker use the owner's attached apps. AiBrain deliberately does not adopt shared-agent credentials: installation + current employee defines the provider user, explicit catalog policy applies, and deterministic reviewed reads avoid importing a broad write-capable MCP router. Melso's local mirror reports active connections without fresh per-card upstream readback; this adapter rechecks upstream. Melso state is HMAC/TTL, while AiBrain reuses durable session-bound one-use state and validates the exact auth config receipt. No Go/TS code was copied; source mechanisms informed the independent adapter. No notices removed.

## Validation and remaining acceptance

- Reproduced the real empty-catalog cause via read-only running-container config/presence inspection; no external provider calls possible with this config.
- 28 local tests across 8 files passed: synthetic lifecycle/API/config, Gmail state regression, mentions/settings and catalog suites. Includes foreign user, foreign account, expired account, duplicate callback, auth-config drift, invalid/pinned tools, empty-key no-call behavior, policy changes, wrong turn, missing @, local revoke on provider failure/retry and reconnect version.
- HTTP route contract: 6 passed. Targeted lint and diff whitespace checks passed.
- Whole-repo typecheck currently blocked by missing `pdf-lib` in reused release dependencies (three unrelated document imports); no connector type errors reported. No dependencies installed or shared tree modified. No heavy build/Chromium/inference run and no heavy lock claimed; browser task has priority.
- Remaining: candidate CI/build; configure own provider/auth configs/scopes; two real employee consents; observe UI Connect → callback → ACTIVE readback → @ → one benign synthetic-record read → revoke → denied subsequent use, including cross-user negative check. Test each actual toolkit's metadata/scopes and provider execution. Existing conversations need a new chat for new dynamic tools. No real email/contact scraping or sends permitted.
- Release integration/deployment belongs only to task `01a06d0d-0ea0-7420-ac29-31015f795d0f`. Connector external dependency must not hold up other critical fixes.

Official API references checked: https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink , https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigsByNanoid , https://docs.composio.dev/reference/api-reference/tools/getToolsByToolSlug .

## Integration review follow-up

The connector screen displays both managed callback outcomes: failure guidance,
or a return-from-consent notice that explicitly directs the user to the
server-verified card status (the query parameter never proves connection).
When managed apps are present, the screen explains that users should open a
new chat and select the app with @; older chats may lack the new tools.
Optional capability listing returns an empty inventory for non-local sessions
or absent toolkit configuration. Configured local sessions still reject a
foreign installation; connect/callback/action authorization is unchanged.

Validation: 16 tests in the lifecycle and Settings component suites passed,
including both callback renderings with a still-unconnected account, new-chat
copy, and non-local/unconfigured inventory behavior. Targeted lint passed.
No brain-app edit, OAuth operation, account creation, heavy test or deployment.
