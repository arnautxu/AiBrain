# Windows document synchronization

## Shared source contention

The scheduled mirror and the knowledge index use the same exclusive source
lock. A busy lock returns `RDP_OPERATOR_BUSY` immediately, without consuming
transport retries. The mirror records a deferred attempt and exits successfully
so systemd does not start a failure/restart loop against another active reader.
The prior snapshot, verified cache, failure count and last-success time remain;
the deferred attempt does not establish current source freshness. A partial
copy cache can resume on the next request, but is not published as a complete
inventory. Genuine transport/policy failures keep their existing failure paths.

## Scope and ownership

The host operator runs `infra/hetzner/rdp-sync.py` using the existing pinned
RDP route and the `read-only-export` policy. The sync cannot expand the
`readRoots` in the private access manifest. No Windows writes, permission
changes, uploads, alternate transport or VPN are used.

The user authorized automatic synchronization, chat access and recovery
testing. On 2026-09-02 they explicitly selected all Arnall users as the
audience. The live publication therefore targets the installation's
`company/shared` document scope. This uses existing `documents.read`
permissions; it does not change user policies or mount Windows into a worker.

## Files and lifecycle

| Component | Host location |
| --- | --- |
| Private sync manifest | `/etc/aibrain/company-qa/rdp/sync.json` |
| Connection and source restrictions | Existing `endpoints.env`, `credentials.env`, `policy.json`, `access.json` in the same private directory |
| Operator programs | `/usr/local/lib/aibrain/rdp-access.py`, `rdp-frame.py`, `rdp-sync.py`, `rdp-extract.py` |
| Private verified originals, cache, state and prior snapshots | `/var/lib/aibrain/rdp-sync/arnall` |
| Per-operation transfer receipts | `/var/lib/aibrain/rdp-imports/arnall` |
| Scheduling | `aibrain-arnall-sync.timer` and `aibrain-arnall-sync.service` |
| Chat-readable text | `<installation dataRoot>/enterprise-documents/company/shared/windows-arnall` |

The example sync manifest has no audience. An operator must explicitly bind
each publication to an existing scope marker matching the installation and,
where applicable, the user, project or department. The host volume path is
validated separately from the container's installation data path.

Each run inventories the authorized tree, refusing truncated or excessive
inventories. It compares size and modification time with the durable cache,
copies new or changed documents with SHA-256 verification, and saves each
verified transfer before proceeding to the next one. A restart can reuse
verified originals without copying them again. Cache hash corruption fails
closed. Unchanged size/mtime is the incremental change detector; this is not
a continuous hash scan of the remote disk.

PDF, DOCX, XLSX and UTF-8 text formats are extracted in a separate unprivileged,
networkless Bubblewrap process. It sees only the input, extractor and system
libraries. Archive sizes, XML entities, runtime, memory and output are bounded.
Credential-shaped content is withheld. Scanned PDFs without extractable text,
unsupported files and extraction failures are counted as unavailable, never
silently presented as readable documents. XLSX uses stored values, without
recalculating formulas.

The app reads bounded UTF-8 fragments through its existing
`aibrain_company_files.search/read` tools. Each fragment carries the source
filename, modification time, copy time and original hash. It is document data,
not instructions or authorization. Raw originals remain private to the host;
this integration provides text reading, not an original-file download tool.

New complete snapshots are built in hidden directories and exchanged
atomically with Linux `renameat2`, avoiding both symlinks and partially written
visible generations. Previous published snapshots and verified originals are
preserved privately. Removed source files disappear from the next complete
visible snapshot but remain in the private history. Automatic retention
deletion is intentionally absent; free-space checks stop before exhausting
disk capacity.

## Recovery and scheduling

The timer checks every fifteen minutes, with up to thirty seconds of jitter.
`Persistent=yes` catches a missed calendar run after startup. Enable it with
`systemctl enable --now aibrain-arnall-sync.timer` after installing and
verifying the supplied unit files.

The service uses its own process group, private temporary directory, resource
limits, read-only system paths and explicit writable destinations. It retries
interrupted RDP operations up to three times. The client detects a dead RDP
process promptly and waits for delayed drive redirection before copying.
Concurrent syncs and operator sessions are locked. Stopping the service kills
its own child processes, leaving customer applications and Windows running.

A Windows drive-policy denial exits with status 78 and avoids the one-minute
service retry loop. The timer can check again at its next scheduled run. An
operator must repair that policy; the sync never works around it. Failed runs
preserve verified data and update the chat-readable status file with the
failure and last complete synchronization time.

Operator checks:

```sh
systemctl status aibrain-arnall-sync.timer aibrain-arnall-sync.service
python3 /usr/local/lib/aibrain/rdp-sync.py --manifest /etc/aibrain/company-qa/rdp/sync.json --status
journalctl -u aibrain-arnall-sync.service
```

Logs contain progress counts and failure categories. Credentials remain in
private host files and are never placed in the repository, model context,
systemd arguments or customer document scopes.

## Live acceptance and outstanding gate, 2026-09-02

- The 08:16 UTC transfer verified one real PDF between Windows and Hetzner.
- At 08:28 UTC, a fresh RDP session observed a regression: the Group Policy
  `fDisableCdm` value was absent, the listener still held `fDisableCdm=1`,
  and effective `DriveMapping=1`, `PolicySourceDriveMapping=0` disabled
  transfer again. The export drive was absent. This is an observed Windows
  state change, not a claim about who changed it.
- The authorized folder inventory contains six supported documents. A manual
  bootstrap published only the already verified PDF, explicitly marked
  incomplete with five pending documents. Its source receipt and manifest
  are retained in private `bootstrap-snapshot.json`. This bootstrap does not
  count as a successful complete synchronization.
- An authenticated live Arnall chat searched and read that PDF, returned its
  actual agreement title and company names, and correctly explained that
  synchronization was incomplete. The response was checked against the
  extracted source. The publication is in the authorized company scope.
- Eighteen Python tests cover bounded paths, copy verification, interrupted
  resume, unchanged-file reuse, incomplete inventory, corrupt cache, changing
  sources, scope binding, Unicode chunks, extraction and credential rejection.
  Nine existing app tests passed for document scopes and turn permissions.
- A host test verified atomic snapshot replacement, preservation of the
  previous generation and status updates, using disposable synthetic data.
- A controlled interruption killed only the RDP client inside the new sync
  service's cgroup. The service logged an inventory retry, reconnected and
  reached the six-document copy phase before the Windows policy denied it
  again (exit 78). The verified PDF remained intact and published, with no
  RDP or Xvfb processes left in that service after exit.
- At 08:35 UTC the timer was enabled for startup and active/waiting, with
  its first scheduled run at 08:45:25 UTC. This verifies timer installation
  and RDP reconnection, not recovery from a physical host reboot.

At this stage complete six-document synchronization was blocked by Windows
drive redirection. The calendar configuration and one-document chat read did
not establish complete synchronization acceptance. The later retest below
records the resolved gates. Host or Windows reboots have not been performed
as part of this test.

No application image, public route or provider credential changed. The
protected app release remains separate from this operator-managed import.

### Successful retest at 08:49 UTC

A fresh run at 08:45 UTC could inventory both approved folders and copy a
new DOCX with a matching SHA-256. Windows drive redirection no longer denied
the transfer. The next stage exposed a service-specific extraction failure:
`bwrap: Can't mount proc on /newroot/proc: Operation not permitted`.

The extractor now provides an empty `/proc` directory instead of mounting
procfs. Its parsers do not require process information. Network isolation,
unprivileged execution, dropped capabilities, read-only inputs and all
systemd protections remain enabled. Real DOCX and PDF extraction then passed
in a transient service with the same protection settings (2690 and 3033
text bytes respectively). Eighteen local Python tests also passed.

The full sync started at 08:47:32 UTC and completed at 08:49:17 UTC:

- Six documents inventoried, including the two documents in `Old`.
- Five new copies and one reused verified copy; all six cached originals
  matched their SHA-256 and all six had extracted text.
- One company-wide snapshot published atomically; no unreadable documents.
- Status `ready`, zero consecutive failures, timer still active with the
  next scheduled run at 09:00:10 UTC.
- The existing authenticated Arnall chat performed new document searches
  and reads, reported six documents, complete synchronization and both
  folders, and returned the actual agreement title from the newly copied
  DOCX. The completed response took 33 seconds.
- Installed `rdp-sync.py` SHA-256:
  `6a17bb90450a1fb504c5846da8638eda77404ff413723150e4fe0c41893b2909`.
- Private acceptance record: `acceptance-20260902-0849.json` in the sync
  state directory, separate from the earlier failed-run acceptance record.

This establishes successful current transfer and complete synchronization;
it does not prove the Windows policy survives a future domain-policy refresh
or a server reboot.

## On-demand synchronization from chat

The company-file `search` and `read` handlers refresh configured imports
before returning imported text. Search validates the query and server-issued
roots first, waits for the refresh, then searches the new snapshot, so a file
missing from the previous copy can be found. Read validates the scope and
relative path before any request and refreshes only its imported connection.
No new dynamic tool is required, so existing conversations retain this behavior
after the application release.

The server-side `OnDemandDocumentSync` client reads root-owned connection
descriptors under `<dataRoot>/locks/document-sync`. It accepts only descriptors for
the current installation and scopes authorized by that turn. It sends a
bounded refresh request over a Unix socket, with installation, connection and
request identifiers. No Windows path, source text, user prompt, credentials or
command enters that protocol. Employee sandboxes have no mount of this host
control directory. The socket and generated descriptor live below the existing
`locks` exclusion for ephemeral runtime state, so they never enter customer
backups or restore snapshots.

`rdp-sync-broker.py` runs separately on the host. It accepts only the configured
application UID through Linux peer credentials and can start only
`aibrain-arnall-sync.service`. Source roots and publication scopes still come
from the operator's private manifest. The broker grants no new source access,
accepts no caller-selected paths and has no TCP listener. The existing shared
data volume carries the socket; no Docker socket or additional port is exposed.

Concurrent requests join one running operation, including a timer-triggered
sync. A successful check may be reused for thirty seconds. A failed check has
a fifteen-second retry cooldown. The client also coalesces overlapping calls
within a turn and expires completed checks after thirty seconds. The broker
uses the sync service's start limit of six starts per minute; an hourly limit
would incorrectly stop normal on-demand usage after a few successful checks.
The broker waits up to 175 seconds; the client bounds its own wait at 185 seconds and
honors turn cancellation. A long sync continues independently and reports
`pending`, never a false successful update. Missing files outside the approved
source roots are never fetched automatically.

Tool results carry `synchronization` status and a check timestamp. A blocked,
failed or unavailable source preserves the last verified copy and returns an
explicit stale-data warning. Missing results during such a failure do not
prove that the source file is absent. The runtime instructions require the
assistant to communicate these limits.

Install alongside the existing sync tools, using the root-owned approved
manifest and application UID/GID already configured:

```sh
sudo install -d -o root -g 10001 -m 0750 /var/lib/docker/volumes/aibrain-company-qa-data/_data/locks/document-sync
sudo install -m 0750 infra/hetzner/rdp-sync-broker.py /usr/local/lib/aibrain/rdp-sync-broker.py
sudo install -m 0644 infra/hetzner/aibrain-arnall-sync.service /etc/systemd/system/aibrain-arnall-sync.service
sudo install -m 0644 infra/hetzner/aibrain-arnall-sync-broker.service /etc/systemd/system/aibrain-arnall-sync-broker.service
sudo systemd-analyze verify /etc/systemd/system/aibrain-arnall-sync-broker.service
sudo systemctl daemon-reload
sudo systemctl enable --now aibrain-arnall-sync-broker.service
```

The broker publishes its scope descriptor at startup. Restart it after an
authorized publication-scope change. Disable it with `systemctl disable --now
aibrain-arnall-sync-broker.service` if rollback is needed; the timer and verified
copies remain available. An application rollback ignores the new descriptor.
The host service installation, application CI/publication/deployment and an
authenticated chat that triggers a new sync are separate acceptance gates.

Pre-release validation on 2026-09-02: 1,092 application tests passed (nine
environment-gated tests skipped), 22 Python tests passed, and typecheck, lint,
contracts, infrastructure validation, production build and automation-worker
build passed. A real request from app UID 10001 completed a source refresh;
a different Unix peer UID was rejected. Three simultaneous container requests
shared one refresh completed at 09:04:20 UTC in about thirty seconds, with
matching request identifiers and six readable documents. The private host
record is `on-demand-host-acceptance-20260902.json` in the sync state directory.
These host checks do not by themselves establish authenticated chat acceptance
of the new application release.

## Resumed-chat incident and source coverage, 2026-09-02

Read-only inspection of the installation serving `fb5d3d56d84f6102b5e3207217e6a8d412ba8bde`
found two separate issues:

- The private access manifest permits operator inventory of `Y:\`, but document
  reading is restricted to `Y:\MATADERO FRIGORIFICO AVINYO`. The retained root
  inventory receipt from 06:46 UTC lists a directory named `PRESSUPOSTOS`.
  It is outside the configured read roots. A ready six-document synchronization
  therefore cannot answer a request to list `Y:\PRESSUPOSTOS`.
- The 09:37 UTC follow-up completed in App Server, but was never projected into
  the chat. Journal event 3474 was the prior turn's `thread/tokenUsage/updated`;
  event 3477 contained the new `turn/start` response at 09:37:03.399 UTC;
  event 3571 recorded `turn/completed` at 09:37:20.481 UTC. The app instead
  reported a 60-second start timeout and a recovery-read timeout. A local
  regression reproducing this event order failed before the routing fix.

RPC responses now have independent per-request routing queues, so a notification
waiting for explicit turn binding cannot block the response supplying that
binding, and a handler can await a same-thread recovery read. Duplicate responses
remain serialized; durable acknowledgements still advance in sequence only after
their handlers/projections complete. Notifications and tools retain thread/turn
ownership checks. Empty document search results explicitly describe their
limited coverage, including when `synchronization` reports `current`.

The transport correction alone does not expand Windows read roots or publication
audiences. The user subsequently authorized access across the server rather
than selected folders. That extension uses a separate on-demand read-only broker
and preserves the already approved company reader audience; see
[WINDOWS_SERVER_FILES.md](WINDOWS_SERVER_FILES.md). The scheduled mirror keeps
its original source roots. Application CI, publication, deployment and
authenticated resume acceptance are separate gates; these incident notes do
not establish that either candidate correction is live.

Local candidate validation: 99 tests passed across transport, gateway, turn
execution, durable projection, company documents, multi-user acceptance and
HTTP contracts. Typecheck, lint of changed TypeScript files, the production
build, generated Codex contracts and static infrastructure validation passed.
The two deadlock regression cases failed on the original router and passed
with the correction. No production state or source policy was changed during
this investigation.
