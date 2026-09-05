# Arnall host storage cleanup

`infra/hetzner/app/arnall-storage-cleanup.sh` is a deterministic host operation
for the `company-qa` installation. It is not an AI agent and cannot choose new
deletion targets. Its default mode is a dry run; the systemd service passes
`--execute` explicitly.

## Deletion allowlist and retention

The operation retains at least seven complete 24-hour periods and can remove
only:

- root-owned, non-writable, non-mounted directories with recognized failed
  release names directly below `/opt/aibrain-company-qa/quarantine`,
  `/opt/aibrain-company-qa/failed-releases` or
  `/opt/aibrain-company-qa/incoming`;
- local digests in exactly `ghcr.io/arnautxu/aibrain` or
  `ghcr.io/arnautxu/aibrain-egress` that are neither `current` nor `previous`
  in release state, are at least seven days old, have the expected OCI
  source/title, have no foreign image aliases and have no running or foreign
  container consumer;
- stopped containers for such an obsolete image only when all product,
  installation and Compose-project labels identify `aibrain-company-qa`.

The operation never removes volumes, user/chat/file data, credentials,
backups, acceptance evidence, dirty Git trees, current or previous rollback
images, BuildKit cache, unlabelled images, global logs, BGreenly or any other
installation. Unrecognized names and labels are preserved. The current and
previous release revisions are also protected if their SHA appears in a
staging name.

Both health endpoints and the running container revision/image identities must
pass before and after cleanup. A dedicated lock prevents overlapping cleanup.
A shared hold on the Arnall deploy lock prevents a release from starting while
cleanup runs; an active release, transaction or release process makes the run
exit without deleting. Each external command is bounded, the whole service is
limited to 330 seconds, and CPU and I/O run at low priority.

Each run reports free bytes before/after, observed filesystem bytes freed,
logical bytes per removed category and exact removed targets. The dedicated log
rotates weekly, keeps eight files and caps each at 1 MB.

## Installation and first run

Run only after the release coordinator has declared a safe checkpoint:

```bash
install -m 0755 infra/hetzner/app/arnall-storage-cleanup.sh \
  /usr/local/sbin/aibrain-arnall-storage-cleanup
install -m 0644 infra/hetzner/systemd/aibrain-arnall-storage-cleanup.service \
  /etc/systemd/system/aibrain-arnall-storage-cleanup.service
install -m 0644 infra/hetzner/systemd/aibrain-arnall-storage-cleanup.timer \
  /etc/systemd/system/aibrain-arnall-storage-cleanup.timer
install -m 0644 infra/hetzner/systemd/aibrain-arnall-storage-cleanup.logrotate \
  /etc/logrotate.d/aibrain-arnall-storage-cleanup
systemd-analyze verify /etc/systemd/system/aibrain-arnall-storage-cleanup.service \
  /etc/systemd/system/aibrain-arnall-storage-cleanup.timer
systemd-analyze calendar 'Sat *-*-* 04:00:00 Europe/Madrid'
systemctl daemon-reload
/usr/local/sbin/aibrain-arnall-storage-cleanup --dry-run
/usr/local/sbin/aibrain-arnall-storage-cleanup --execute
systemctl enable --now aibrain-arnall-storage-cleanup.timer
systemctl show aibrain-arnall-storage-cleanup.timer \
  -p ActiveState -p UnitFileState -p NextElapseUSecRealtime
systemctl list-timers aibrain-arnall-storage-cleanup.timer --all --no-pager
```

The timer expression contains the IANA timezone explicitly. The host may remain
in UTC: systemd calculates 04:00 in `Europe/Madrid`, including DST changes.
`Persistent=true` catches up one missed run after host downtime. The Mac is not
part of this path.

## Inspection and rollback

```bash
systemctl status aibrain-arnall-storage-cleanup.timer \
  aibrain-arnall-storage-cleanup.service
tail -n 200 /var/log/aibrain/arnall-storage-cleanup.log
```

To stop future runs, disable the timer. The script and units can then be
removed. Deleted failed staging is regenerable from Git/GHCR; removed obsolete
images are pullable by immutable digest. No durable data is deleted, so there
is no data-restore step.
