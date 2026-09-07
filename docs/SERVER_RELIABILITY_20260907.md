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
