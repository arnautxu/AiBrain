# Server: live Windows references

Candidate 2026-09-07. This extends the existing Arnall read-only broker; it does
not mount Windows in the application or use the unrelated Studio CIFS mount.

## Behavior

Server in the composer band and + menu opens drive/folder browsing. Every page
and refresh calls the authenticated `/api/server-files` route, authorizes the
installation, actor and project, resolves company document permissions, and
calls the host socket with `operation=browse`. This operation never reads the
metadata map. The UI refuses results without `sourceChecked=true`, clears
previous rows while loading and reports busy/unavailable instead of showing an
old snapshot. Pages are bounded to 50 entries and are not a filesystem snapshot.

Up to five file/folder references can be attached without changing prompt text.
Draft references are isolated by installation, user, project and conversation;
submitted references persist with the user message and participate in retry
identity validation. They are data, not permission grants. On execution the
server rechecks company access. Files are freshly copied/verified/extracted by
the existing reader; folders get one fresh metadata page, with no recursive
content import. `search(query="live:server:/...")` supports fresh continuation
even in existing conversations retaining the older tool schema.

## Versions and editing

References use connection + encoded Windows path; they are stable across
refresh and content edits, but NOT across rename/move. A moved/deleted reference
is reported as a partial limitation and must be selected again; other valid
references and the prompt remain usable. Unsupported content formats are
reported explicitly, with selection-time metadata clearly marked as unverified
current state, and binaries are never executed. Windows file IDs/volume IDs are not
currently exposed. Selection captures size/mtime; the actual turn records the
fresh SHA-256 and source time in its input and labels changes since selection.
Multipart reads must keep the same hash. Metadata is not a content version.

The existing installation Windows account and company audience are unchanged.
This is not per-employee Windows impersonation: AiBrain actor/project/company
permissions precede the shared technical account's existing Windows ACLs.
Path traversal, alternate streams, reparse points, foreign connections and
credential paths remain rejected by the existing host reader.

Windows remains `read-only-export`. An edit request prepares a new artifact
using the existing document workflow; it does not overwrite the original.
Original publishing would require a separately approved write transport and
target roots/account, immutable version backup, mandatory expected SHA-256,
OS-level exclusive write/replace with no check/write gap, conflict rejection,
idempotent operation receipt and source readback. The current Hetzner publisher
must not be described as a Windows publisher. XLSX extraction is values only;
do not promise preservation of macros, layout or formula recalculation.

## Host rollout and rollback

The app change requires the matching `rdp-server-files-broker.py` on the host.
Verify the installed file matches the pre-change revision, back it up, install
the reviewed replacement preserving root ownership/mode, and restart only the
server-files service when no reader is active. Do not modify connection
manifests, credentials, RDP policy, Windows files, scheduled mirror or Studio.
Check a bounded live root listing with the app UID. Then run the normal CI,
GHCR and app release gates and authenticated selector acceptance separately.
Rollback restores the prior broker backup and app release; no source data is
deleted. Older application search/read/inventory behavior is preserved.

## Acceptance

- Offline broker test: map contains old data; two live browse requests observe
  an externally changed fixture without calling the map.
- Actor/tenant/project denial before broker access; invalid paths and stale
  source evidence rejected; no Windows writes or network discovery.
- Desktop/mobile: open from band and +, navigate, refresh, select file/folder,
  preserve prompt, remove chip, reload draft, change conversation without leaks.
- Persist/restart message references; changed-reference retry is a conflict.
- Fresh file version reaches turn input; unavailable/deleted content is withheld and reported without aborting valid references;
  folder selection does not recursively read content.
- Production: exact app SHA + active host broker + authenticated browse/select.
  A real external-update test requires an operator to edit a disposable Windows
  QA fixture; simulated tests do not prove that separate live gate.

## Composio boundary

Fresh inspection before this change: zero configured toolkits and no
`AIBRAIN_COMPOSIO_API_KEY`; Google/Microsoft OAuth application IDs/secrets and
Microsoft tenant absent; both OAuth encryption keys present. Registration for
David/GraphikAI is separate from each employee's personal connector consent.
Use a separate GraphikAI-Arnall project, reviewed auth configs/scopes and pinned
read tool versions. Never reuse Melso credentials or share personal connections.

The `GraphikAI_Arnall` Composio project now has managed OAuth configs for Gmail,
Google Calendar, Google Drive and Outlook. Provider readback confirmed exact
read-only scopes and 13 allowed, version-pinned tools. The runtime key permits
tool definitions, auth-config reads, personal account linking/revocation and
execution of those allowed tools. The temporary provisioning key was revoked.
Personal OAuth and a successful app read remain separate acceptance gates.

The standalone release manager must also validate the Composio manifest; the
previous gate admitted only native Gmail/Outlook. Promote a target installation
config through the release manager, preserving the active config checksum and
using the original reviewed Compose/seccomp inputs from the release record.
Do not directly patch the active installation file or weaken the release gate.
The authenticated server egress channel admits the exact HTTPS host
`backend.composio.dev` alongside the configured Supabase host. IP literals,
other ports, private DNS answers, redirects and other hosts remain rejected.
The Composio adapter still enforces tenant/user binding and reviewed tools.

Official pricing checked 2026-09-07: Free is hard-capped, no card. Own-app calls
have 100K/month; managed apps up to 20K within that amount. The current adapter
uses direct execution, whose free add-on allowance is 10K before Pro is needed.
Do not interpret 20K/100K as guaranteed effective capacity for this adapter.
No paid tier, card or premium tool is authorized.

Sources: https://composio.dev/pricing and
https://docs.composio.dev/docs/authentication/controlling-scopes.

Current investigation and separate acceptance gaps: [SERVER_RELIABILITY_20260907.md](SERVER_RELIABILITY_20260907.md).
