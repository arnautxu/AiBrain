# Read-only access across the Windows server

The 2026-09-02 scope correction authorizes access across the server, not a
selected folder allowlist. The connection uses the installation's Windows
account and its existing OS permissions. The configured source authorization
covers all drive letters; live discovery returns the local and mapped drives
actually present in that Windows session. Redirected `tsclient` drives,
reparse traversal, credentials and remote writes remain excluded.

This is a separate on-demand path from the small scheduled document mirror.
It does not recursively copy the whole server or expand that mirror's timer.
It supports browsing directories, bounded recursive filename search and fresh
text reads of supported documents. The account's accessible server filesystem
is not equivalent to SQL access to the database or arbitrary Windows commands.

The metadata-map extension now makes indexed folder/file metadata the first
lookup path. Background traversal lists directories without extracting all file
contents. See [SERVER_METADATA_MAP.md](SERVER_METADATA_MAP.md) for cached-result
freshness, partial coverage, policy checks and separate installation acceptance.

## Employee tools and existing conversations

The existing `aibrain_company_files.search/read` tools remain compatible with
resumed conversations. New conversations also expose `inventory`; older threads
reach that same operation through `search` with `inventory:<server-path>`, without
resetting history. See the metadata-map runbook for coverage and continuation.

- `search({query: "server:/"})` discovers server drives.
- `search({query: "server:/Y/"})` lists the shared drive.
- `search({query: "server:/Y/PRESSUPOSTOS"})` lists a specific directory.
- `nextQuery` continues large directory listings. Offset pages can change if
  the source folder is edited concurrently; they are not a frozen inventory.
- Positive runtime page sizes above 50 are capped before either backend is
  contacted. Invalid parameter types or non-positive sizes return a parameter
  error, not a claim that the employee lacks source access.
- A plain term searches local text plus live server filenames. Server search
  is bounded by time, directories and entries; `limited`/`truncated` prevents
  interpreting empty results as absence from the entire server. Navigate to
  a specific folder to inspect it completely.
- `read({scope: "company", path: <returned server-connection/... path>})`
  copies and verifies that file on demand, extracts text in a networkless
  unprivileged process and returns source path, modification time and SHA-256.
  `nextPath` selects another bounded text part. Compare hashes between parts;
  stop and reread if the source changed.

Each read is fresh. The current extractor supports PDF, DOCX, XLSX, XLSM and UTF-8
TXT/CSV/MD/JSON, up to the existing 16 MiB source and extraction limits. Other
formats can be listed, but an unsupported/scanned/unreadable file must be
reported accurately. Original files remain private in the host import area.
There is no remote write, rename, delete, permission change or shell tool.

### Spreadsheet chat preview (local candidate, 2026-09-03)

The first fresh XLSX/XLSM read returns a bounded worksheet/cell representation.
The app persists only this data representation in the requesting project and
registers its actor, project, thread, hash and source timestamp with the existing
library resource index. Its authenticated download endpoint verifies the stored
hash; the chat card opens a sheet selector and paginated cell grid in the existing
document panel, including mobile focus management. The JSON download is explicitly
the preview data, not the original workbook. Originals remain on the host.

The parser reads OOXML values only: no VBA, macro execution, external links,
formula evaluation or Office process. Sheet names, hidden-sheet flags and sparse
cell addresses survive. Common date/time formats are displayed; unknown formats
retain raw values. Missing formula caches are labelled. This is a data view, not
a pixel-faithful reproduction of printing, merged cells, colours or charts.
The grid has a 60 KB cell/name budget and 2,000 cells per sheet (100 sheets
maximum), with explicit partial coverage; text remains separately paginated.
The bounded parser accepts up to one million scanned cells, including empty
styled cells. The real S’Agaró workbook contains 351,692 cells across 43 sheets;
its host-side sandbox extraction passed after correcting the initial 100,000-cell
ceiling. Archive/XML, output size, memory and CPU limits remain enforced.
The grid reserves 95% of its data budget for visible sheets when a workbook also
has hidden sheets, shared across those visible sheets. Hidden templates therefore
cannot consume the entire preview. The viewer opens the first populated visible
sheet by default; workbook tab order and the hidden-sheet labels are retained.
Read failure never creates an artifact; preview failure preserves successful text
reading and reports a preview warning. Existing conversations receive the updated
runtime instructions without a new tool schema or manual re-upload.

Release requires installing the candidate `rdp-access.py`, `rdp-sync.py`,
`rdp-extract.py`, `rdp-frame.py` and `rdp-server-files.py` together in the operator-managed server
files bundle, preserving the existing owner/mode, manifest, sandbox and source
permissions. Restarting its broker and updating any separately installed mirror
bundle are host changes requiring explicit authorization. The app image alone
does not update these files. Keep the previous bundle for rollback. Backend CI,
GHCR publication, deployment and an authenticated read of the actual schedule
workbook are separate pending gates; local synthetic tests do not prove them.

Local verification for this candidate: 1,147 application tests passed (nine
environment-gated cases skipped), 48 Python extraction/RDP tests passed, and
four browser cases passed for spreadsheet/PDF desktop and mobile previews.
The browser cases use synthetic data and intercepted chat/file responses;
separate artifact tests exercise real private persistence, resource binding,
idempotent readback, tamper rejection and the turn-bound read hook. Typecheck,
production app and automation-worker builds, changed-file lint, generated
contracts and static infrastructure checks passed. The original checkout and
all production/source systems remain untouched.

## Trust and process boundaries

`ServerDocumentFiles` verifies server-issued company roots and a root-owned,
read-only descriptor under `<dataRoot>/locks/server-files` before connecting to
the Unix socket. A denied company scope never contacts the host. The host
validates the installation, connection, operation and data fields, authenticates
the app UID through `SO_PEERCRED`, revalidates the company scope marker and
selects only operator-configured endpoints and credentials.

Paths and queries are encoded JSON data in a fixed PowerShell program. Each
operation is kept within the Windows console command limit. Drive
redirection back to the host, reparse points, traversal, alternate streams and
credential-shaped content are rejected. No caller can provide code, credentials,
a host destination or a different account. Per-call processes have a deadline;
only one operation runs at a time and a busy response is explicit.

The broker reads files for existing company readers, the audience already
used by the installation's document connection. The Windows account is shared
at installation scope; this does not impersonate each employee's individual
Windows ACLs. AiBrain's company permission and tenant boundaries remain in force.

## Operator installation

Keep the candidate toolset together under `/usr/local/lib/aibrain/server-files/`:

- `rdp-server-files.py`, `rdp-server-files-broker.py`;
- `rdp-access.py`, `rdp-frame.py`, `rdp-sync.py`, `rdp-extract.py` from the same reviewed revision.

Use a separate private `server-access.json` cloned from the current access
manifest. Set `inventoryRoots` and `readRoots` to the 26 drive roots `A:\` through
`Z:\`, preserving target, byte/entry limits and all existing read-only policy.
Use `server-files.json`, cloned from the sync manifest, with only its
`accessManifest` pointing to the new private manifest. Keep its approved company
audience, installation, source endpoint, app UID/GID and host data paths.
Do not change the scheduled sync's original access manifest.

Both manifests are root-owned regular mode-0600 files. The service and socket
are installed only after reviewing the actual manifests and existing state.
Create `<dataRootHost>/locks/server-files` as root with the app group, mode 0750,
then install `aibrain-arnall-server-files.service`. The service uses strict
filesystem protection; writable paths are only its socket directory, private
temporary space, the existing import destination, and the metadata inventory's
installation-scoped operator and server-map directories. It has no Docker socket
or TCP API. It may contact only the existing pinned RDP destination through the
fixed operator program. The source account still needs no Windows write access.
`AF_NETLINK` is required for Bubblewrap to create loopback in the extractor's
new network namespace; without it, `--unshare-all` fails before parsing the
document. This does not give the extractor an external network interface.

The descriptor/socket are below the backup-excluded locks directory. The
scheduled mirror, previous verified imports and existing application release
remain available independently. Rollback disables the new service and restores
the previous application revision; it does not delete customer source files or
verified copies.

## Acceptance gates

1. Local source, path/permission/response-binding, pagination and cancellation
   tests; existing RDP policy and sync regression tests.
2. Real drive discovery and a directory outside the old folder allowlist, with
   source metadata readback. One supported file must be copied with matching
   Windows/host SHA-256 and extracted under the service's restrictions.
3. Host socket request from the configured app UID; a different UID is denied.
4. Separate Backend CI, GHCR publication and application deployment for the
   candidate SHA.
5. Authenticated existing-chat resume, live folder listing and supported file
   read. Source permissions, rejected writes and unavailable formats remain
   explicit. Host-only acceptance does not establish application acceptance.

## Candidate evidence, 2026-09-02

The private host candidate used separate all-drive manifests; the installed
application still served `fb5d3d56d84f6102b5e3207217e6a8d412ba8bde`. The existing
sync manifest and service were not changed, and no permanent server-files socket
or service was enabled during these probes.

- 10:06:50 UTC: live discovery returned `C:\` and `Y:\`.
- 10:07:38 UTC: `Y:\PRESSUPOSTOS` returned all five year directories, `2019`,
  `2022`, `2023`, `2024`, `2025`, without truncation.
- 10:08:30 UTC: the `2025` directory returned one subdirectory and one PDF,
  without truncation.
- 10:14:29 UTC: a fresh read of that PDF verified 86,682 bytes against Windows
  SHA-256 `d9c9f2d77e299766b54cf32faf1b40e6bb9ef9fc26ef505a85016c97d3e812bf`
  and extracted 1,405 characters in one part. Copy and networkless extraction
  ran under a transient root service with the candidate's filesystem, device,
  home, privilege, memory and task restrictions.
- 10:15:04 UTC: a live recursive name query found `Y:\PRESSUPOSTOS` and six
  other matching directories. It correctly returned `limited=true` and
  `truncated=true`; this was not a complete server inventory.
- The actual Linux Unix-socket server accepted UID 10001 and rejected a
  different UID. This used an ephemeral socket and controlled handler response
  to isolate peer authentication; it did not expose a production socket or
  query Windows. The document read above separately exercised the real source.

Local validation passed: 1,102 application tests (nine skipped), 33 Python RDP
tests, full lint, TypeScript checks, production build, automation-worker build,
generated Codex contracts and static infrastructure validation. No customer
document content or connection credentials are recorded in this repository.

Backend CI, GHCR publication, application deployment and authenticated chat
acceptance are still pending for this candidate, including resuming the
conversation from the incident. The host results above do not close those gates.

After deployment of `6d5fe79`, authenticated chat at 10:34–10:35 UTC revealed
that the runtime requested `limit: 100` in all three search calls despite the
schema's maximum of 50. The old argument guard returned its generic permission
failure before contacting the host. A regression reproduced this exact call;
the correction caps positive page sizes at 50 while retaining scope checks,
host limits and pagination. Its application release and live acceptance must
be verified separately from the successful host connection.

The installed service's first real PDF read copied and verified the source but
failed extraction: its address-family filter omitted `AF_NETLINK`, causing
`bwrap: loopback: Failed to create NETLINK_ROUTE socket`. The earlier transient
copy probe had not included that filter. An exact protected extraction probe
reproduced the error; allowing `AF_NETLINK` restored extraction while keeping
`--unshare-all`, the unprivileged extractor and all filesystem restrictions.
