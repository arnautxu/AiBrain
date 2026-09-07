# Server reliability investigation — 2026-09-07

Status: partial fixes; NOT accepted. Base `fb882a2b7be9fe6a0cad95354963bf46d782bb42`.

| Reported bug | Cause / evidence | Change | Acceptance still needed |
| --- | --- | --- | --- |
| Backdrop is a composer-height strip | Fixed-position overlay nested in composer containing block; supplied screenshots | Portal to document.body, existing focus trap/restore, dialog description and fallback focus | Rendered desktop/mobile, light/dark and keyboard checks on deployed SHA |
| C/Y displayed as folders | Drive roots have directory kind in reference contract | Recognize drive-root paths, display drive icon and Unidad C:/Y:, do not attach entire drives | Real deployed listing |
| Unreadable exe aborts turn | serverReferenceInputs throws when reader rejects unsupported format | Per-reference limitation with error category and explicitly selection-time metadata; preserve valid references and prompt; never execute a binary or infer function from name | Actual exe selection and successful limited response |
| Close/reopen starts competing Windows requests | Browser abort closes socket but host subprocess continues | Share ongoing read only within identical installation/user/project/resolved-roots/query, max32; independently reauthorize each subscriber; no completed-result cache | Real close/reopen during request; multiple app-process limitation remains |
| Slow listing / busy | Live C:/ listing: 50.040s total, 37.025s RDP startup, 3.812s execute. Two subsequent bounded probes failed CATALOGUE_BUSY after55s waiting for background inventory | Investigation only; host unchanged | Cold/warm p50/p95 and genuine 2→4 authenticated QA users |
| Y unavailable | Not yet distinguished from transport/session/mapping errors | No root or ACL changes | Live mapping and bounded first-level listing |

## Measurements and boundaries

The old assertion that a 4,818-character command incurred 48s of keyboard typing
was wrong and withdrawn by its author. The installed Server RdpSession uses
xclip/ctrl+v for that command. Only `cmd /d` uses type_text. Do not cite the
hypothetical typing calculation as measured latency.

The successful C:/ probe at 15:41:45 UTC enumerated one page of metadata only.
C:/Arnall exists. This does not establish it as the approved business root.
The pre-existing bounded mirror is configured for a Y: business folder; that
configuration does not prove the mapped drive is available in a new RDP context.
Only the unrelated Studio CIFS mount exists on Hetzner and is excluded.
No Windows documents or policies were changed. No fixtures were created.

Three separately installed RDP modules exist under /usr/local/lib/aibrain,
/knowledge and /server-files; the Server copy matches the repository at baseline.
Background inventory holds inventory.lock and current readers hold operator.lock.
The broker admits only one live operation. This does not establish multiuser
parallel access; in-flight coalescing repairs duplicate reopens only.

## Melso comparison

Confirmed local remote: albertsalgueda/melso. Its
server/internal/handler/workspace_files.go lists workspace_file database rows
scoped by workspace and parent; cloud files use storage keys/content_version.
fs_mount.go exposes authenticated RPC lists/read URLs for that managed library.
This is not a direct Windows folder transport and cannot replace a fresh RDP
filesystem read with the same latency guarantees. Reusable ideas: scoped request
identity, versioned reads, pagination and invalidation. No Melso credentials,
service, or code were transplanted.

## Release / remaining decisions

App-only change; no host rollout required. Normal main → Backend CI → Publish
GHCR → Deploy Arnall gates apply. Preserve connector configuration and callback
fix. Successful CI is not Server acceptance.

Need authorized isolated QA identities and disposable Windows fixture for
external-change/readback and 2→4 user tests. Need confirmed business roots before
hiding any potentially useful location. A new private direct transport or
Windows resident service would need a concrete approved plan; no ports, firewall,
credentials, ACLs or persistent Windows services have been changed.

## Additional live evidence and scoped host correction

The lock holders were identified by PID/module/start time, without killing or
altering them: knowledge-map.py held inventory.lock while rebuilding the local
map; rdp-access.py was a child of the scheduled rdp-sync.py holding operator.lock.
These are legitimate jobs, not abandoned lockfiles. Live browse/read do not use
the catalogue; their broker now requests background yielding without acquiring
the catalogue lock. The existing exclusive Windows source lock remains intact.
Unsupported read formats are classified in the bounded lookup lane before any
RDP or catalogue wait, with publication ownership and request validation intact.
Broker request logs add elapsedMs and an allowlisted error code beside requestId,
never paths, prompts, credentials or file contents.

A bounded follow-up read-only probe acquired the actual source lock in0.523s,
opened RDP in35.901s and listed C:/Arnall in5.854s and Y:/ in2.800s in the same
session. C:/Arnall contains Compres and Vendes. Y:/ returned a partial50-entry
page with business folders. A separate metadata-only probe waited22.682s for
the source lock and35.695s for startup. Win32_LogicalDisk reports both C: and Y:
as DriveType3 (local fixed disks), ProviderName null; Y: label is Disc2.

The latter probe read only file/version metadata for the user-selected
C:/Arnall/Vendes/PreusVenda.exe:121281818bytes, version1.0.0.0,
modified2026-05-20T12:49:38.9324970Z, empty product name and file description.
It was never executed or exported. No function is inferred from its name.

These are small diagnostic samples, not production cold/warm p50/p95. The
warm2.8–5.85s measurements reuse a diagnostic session; the deployed app does not
currently keep that session alive across folder clicks. The~1s warm/few-seconds
cold objective remains unmet. True2–4 user acceptance and external fixture
refresh remain blocked on authorized QA identities/fixture. Root selection was
asked explicitly; no Windows roots or ACLs have been changed.

Host rollout must verify baseline broker272484b4... and folder helper4ccb8630...
against the installed originals, preserve private backups, and wait for no
active broker readers before replacing only these two files and restarting
only aibrain-arnall-server-files. Inventory/sync services and their separate
module copies remain untouched. Rollback restores those two backups.

## UI and executable acceptance on the first app correction

App3057eb79 passed CI34140116630, Publish34140543331 and Deploy34140753073;
live revision readback matched. With the host correction41bd4208 installed,
the actual app UID read returned SERVER_FORMAT_NOT_READABLE in78ms, request
352c4424-e071-48f9-85a5-3f4579986cfa, without RDP. A new branch in David's
existing test conversation completed a safe executable-reference answer in46s,
explaining unsupported binary content and selection metadata without inventing
function or executing the file. This is one-user acceptance, not2–4 users.

The old conversation retry instead returned "no rollout found for thread id".
No runtime/workbench file is changed in these fixes. Code inspection shows
runtime identity is persisted after thread/start, before serverReferenceInputs;
previous unsupported-reference failure can therefore leave an identity before
any successful model turn materializes a rollout. This is a probable independent
recovery defect, not confirmed loss of conversation history. No history/token was
reset or deleted. Hand off worker-codex-turn.ts resume error classification and
unmaterialized-thread recovery; require evidence before any replay.

Rendered checks passed at1920px desktop and390x844 mobile in light and dark.
On mobile, measured backdrop is x0/y0/390x844 and its parent is BODY; dialog is
x12/y210.25/366x423.5. Tab/Shift-Tab stay inside. Dark-theme emulation and viewport
were restored afterwards. The live Escape check discovered focus returning to
BODY when the opening menu item unmounted; explicit stable trigger references
now return to the + button or the landing Server button. This final wiring has a
regression test and requires its own deployed readback.

## Optional private transport follow-up

Shared, installation-bound opt-in broker integration and its offline tests are
now versioned; see [SERVER_PRIVATE_TRANSPORT.md](SERVER_PRIVATE_TRANSPORT.md).
The default transport remains unchanged. Live activation, Windows-specific
copy/recovery tests, selected work roots, 2–4 QA identities and performance
acceptance remain pending. No new Windows session or deployment was performed
for this follow-up. Account names do not establish dedicated/read-only identity.
