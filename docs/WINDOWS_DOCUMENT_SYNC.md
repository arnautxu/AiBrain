# Windows document synchronization

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
| Operator programs | `/usr/local/lib/aibrain/rdp-access.py`, `rdp-sync.py`, `rdp-extract.py` |
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

Complete six-document synchronization remains blocked until Windows drive
redirection is persistently allowed. Do not call a calendar configuration or
the one-document chat read a complete synchronization acceptance. Host or
Windows reboots have not been performed as part of this test.

No application image, public route or provider credential changed. The
protected app release remains separate from this operator-managed import.
