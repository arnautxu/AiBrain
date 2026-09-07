# Shared connector catalog and composer — 2026-09-07

Candidate, not production acceptance. Base 3bcfd21f. Shared AiBrain code serves
all installations; credentials, manifests, catalogs, roles, identities and data
remain installation-specific. MODTIME must never inherit Arnall's Google or
Windows configuration.

## Catalog and scope

Settings, @ and Tools consume the server-authorized catalog, including apps
that still need personal OAuth. Search has no connected-only or eight-result
cap. Public provider logos are bundled locally (source logos.composio.dev,
2026-09-07); no remote tracking request or CSP expansion. A fallback appears
when a logo is unavailable. Disconnected state never becomes read authority.

The full *authorized* catalog is the installation manifest intersected with its
resource/role/group/user rules. Composio's global catalog is not an access
policy. No arbitrary provider app or tool becomes callable from its name.
The reviewed optional manifest fragment in config/connector-profiles adds eight
apps / seventeen version-pinned read tools, inspected from Composio v3.1 on
2026-09-07. It is opt-in per installation, not seeded into every client.
GitHub's limited OAuth scopes permit public repository reads; they do not
promise private-repository access. No general `repo` or write scope is granted.

`authConfigId: on-connect` means configured for first explicit Connect. Browsing
never provisions accounts/configs. Start checks the authenticated catalog first,
then a cross-process installation/fingerprint lock resolves or creates managed
OAuth with the exact reviewed scopes. The config ID receipt is private and
fingerprinted by installation, slug, scopes and pinned tools. Creation verifies
provider scheme, slug, status and exact scope readback before persisting. Scope
changes invalidate the local receipt. Provider/network failures remain visible.
An interrupted provider POST may leave an unused auth config; no personal
account is authorized by creating that config. Do not blindly delete configs
with accounts. No subscriptions, upgrades or payment fields are involved.

Separate optional secret AIBRAIN_COMPOSIO_CATALOG_API_KEY needs toolkits read
and auth configs read/write. Existing runtime key stays unchanged. Host release
runner must support the on-connect sentinel before promoting that manifest.
Source: https://docs.composio.dev/docs/authentication/controlling-scopes .

## Editing and continuity

Native textarea retains selection, undo, copy/paste, IME and attachments. A
metrics-matched decorative layer replaces the visual @ with the real logo and
styles only explicitly selected labels. Removing/editing the token removes its
ID; ordinary typed/copied @ text does not grant authority. Queries are resolved
at the caret, preserving text after it. Popovers follow the caret and visual
viewport; task menus center on mobile with internal submenu navigation.

Draft IDs are stored separately from plain text under tenant/user/project/thread
keys. Submitted IDs persist separately in ChatMessage and duplicate-turn checks;
restored requests retain them. The worker reauthorizes every ID for every turn.
Old records without the optional field remain readable. Older releases with
strict message schemas cannot read the new field: rollback after new turns needs
a compatible reader or the installation's tested recovery procedure; never
blindly downgrade durable data.

## Shared UI adjustments

Template feature label is Tareas recurrentes (not actual cron creation). The
band matches composer width and stays one row at 320/390 px. Login email and
password reserve an explicit icon gutter, including autofill. Composer font is
16px, manual zoom remains unrestricted, and idle landing focus uses preventScroll
without stealing an active control/dialog. iOS may require a gesture to show
its software keyboard; desktop emulation cannot prove native iOS keyboard behavior.
Chat reading text is reduced by one px without changing input/control sizes.

## Required release evidence

Record local tests, Backend CI, GHCR publication, Arnall deployment/readback and
separate authenticated acceptance. Then update MODTIME using its own image-only
runbook, config/branding overlay, auth/data/backup and exact prior image IDs.
Inspect live logo/text overlap at mobile/desktop light/dark, native typing,
caret selection/deletion/IME, menu boundaries, attachments, restart persistence,
connected/disconnected state and denied cross-user/tenant calls. Do not claim all
installations updated from a main commit alone.

Expert now requests gpt-6-astra / medium. Fast (terra low) and Smart (sol low)
remain unchanged. Official support: https://developers.openai.com/api/docs/models/gpt-6-astra .
Worker model/effort catalog checks fail visibly when unavailable; production
acceptance must record requested and effective model, not merely the UI label.

## Initial password compatibility

The shared challenge decoder accepts nonempty bounded opaque refresh tokens. Self-hosted GoTrue uses 12-character tokens; the previous minimum of 16 rejected fresh challenges as expired. Regression coverage verifies a 12-character token, tenant binding, one-time consumption and empty-token rejection. David MODTIME's account was recovered separately through the authenticated identity provider and verified in the real browser; no other user's password was changed.

## Release sequence

This first candidate includes the reviewed catalog/composer, Tareas recurrentes, Experto Astra medium and password compatibility changes. The per-installation English/Spanish interface selector is a separate candidate still being implemented; it is not included or claimed deployed in this first release. Existing customer data and company installation configuration remain separate.
