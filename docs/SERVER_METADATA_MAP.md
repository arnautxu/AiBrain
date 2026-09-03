# Server metadata map

The default background job lists directories and persists names, paths, sizes,
extensions and modification observations. It does not copy or parse each file.
The existing operator catalogue and traversal cursors are reused. Unsupported
content formats can still be located by filename. Windows remains read-only.

The metadata schedule uses `--spread-pages`: smaller durable directory offsets
come first, then explicit business-root priority and discovery order. Unvisited
folders therefore advance before another large folder is drained. This ordering
resumes across batches/restarts without resetting a cursor or retry budget.
Listing receipts include the observed reparse attribute, so excluded junctions
are not accidentally queued as ordinary directories and retried as unavailable.

`knowledge-map.py` projects a consistent read transaction into a separate private
`server-map/catalogue.sqlite3`, atomically replaced after integrity checking. The
projection contains metadata only, not document chunks or extracted text. Parent
indexes support directory pagination; literal case/accent-normalized name/path
terms support local search. No model or external provider is needed.

Root-owned `server-map/README.md` and at most128 short `folders/*.md` guides cover
the first directory levels, balanced between observed drives, known direct-child counts, extensions and traversal
status. Folder business purposes remain explicitly unconfirmed. These dated,
generated guides do not confer permissions and are not a second search authority.
Older unreferenced guides may remain historical artifacts; only the current
README identifies the current projection's guides. No guide is automatically
inserted into an employee's prompt or published company-wide.

Directory search results carry a bounded `folderContext` from the same map:
observed child kinds, common extensions and up to6 child-directory names, filtered
by current source policy. These are observed structural descriptions; business
purpose remains unconfirmed. The counts are explicitly partial and limited to
the first200 known direct children. No whole-map prompt injection is introduced.

## Lookup and permissions

The server-files broker's existing search operation consults the map first.
Absent maps, changed policy bindings and unmapped explicit directories use the
existing live listing path. Empty name searches in a partial map remain explicitly
inconclusive; they do not silently launch another all-server recursive crawl.
The read operation retains the existing fresh copy, hash verification and sandboxed
extraction. No cached filename result itself establishes current Windows access.

The map binds installation, connection, publication scope and both source-root
policies. The broker still verifies app UID, request identity, company reader
scope and publication ownership. Both current root policies are checked before
results are returned. Withdrawn sources and known denied directory descendants
are omitted. Root-owned storage, regular-file checks and no symlink traversal
preserve the existing host boundary. Per-user authorization remains in AiBrain;
an operator inventory never widens reader permissions.

`checkedAt` is the response anti-replay timestamp required by the existing client.
For map results it means the local lookup time, not a fresh Windows check.
`lookupMode=metadata-map`, `sourceChecked=false`, per-result `observedAt`, map
generation time and a plain-language warning preserve that distinction. Directory
observation times have scan precision; file times come from their actual inventory
observation. Coverage always disclaims a frozen snapshot. Unknown/deleted/renamed
paths require on-demand source verification; pagination alone cannot prove deletion.

## Installation and acceptance

Pause the old inventory timer and let its exact invocation finish. Back up the
service definition and changed modules. Install the map helper in both knowledge
and server-files bundles before replacing the server-files broker. Existing broker
parents execute a fresh child script per request, so no running request or app
restart is required. Check parent hashes against the reviewed baseline first.

Build the first map from the existing catalogue, run positive/negative scope,
literal search, identity, time and pagination checks, and prove a search roundtrip
through the actual app-UID socket. Compare source-job counts before/after that
lookup to verify no RDP session opened. Resume the metadata-only unit/timer and
check directory progress and process commands. A content read remains separately
verified by the existing document pipeline; no unsolicited content copy is needed
to accept a metadata-only schedule.

Rollback restores the prior broker module and leaves metadata mapping available;
do not automatically resume the superseded bulk-ingestion schedule. Existing app
image, verified content, small mirror and user data stay intact. Application source
changes still require their separate CI, publication, deploy and authenticated
acceptance gates.

## Personal memory

Reuse each provisioned user's existing private `PROFILE.md`, `PREFERENCES.md`,
memory journal and governed records. `knowledge-memory-layout.py --manifest ...`
adds only a non-overwriting `memory/README.md` to enabled, identity-checked users.
The fixed guide explains the actual stores, sources, revisions and project scopes.
It neither copies user facts elsewhere nor creates a second memory authority.
Existing user notes, decisions, project boundaries and application retrieval stay
intact. Detailed Markdown exports of individual memory records are not enabled by
this guide and would need deletion/revision synchronization before activation.
