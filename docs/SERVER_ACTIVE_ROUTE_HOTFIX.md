# Active Server route — 2026-09-07 follow-up

This hotfix targets the deployed default transport, independently of the disabled
private-channel candidate 5fee4ff. No new Windows session, identity, permissions,
customer data, scheduled-worker shutdown or bridge activation is required to
install the host files. It is shared infrastructure; configuration remains per
installation.

## Reproduced on the deployed product

Arnall release-state: 8fcf246fc334ffdf99eb9007e49c27f07645126d,
promoted 2026-09-07T18:09:05Z. The host broker still matched 41bd4208's installed
SHA-256 0a7a6799c4aebf1a419db0c6cdd48cde7979d8204d7cf26efdc3fc01930424b2.
Its command had no `--transport-config`. App publication did not enable 5fee4ff.

- 18:16:24Z / 18:16:26Z: browse refusals in 118/131 ms, `SERVER_FILES_BUSY`.
- 18:17:29Z: request 16485934-0ae7-494d-b60b-e06538b6b915 failed after
  59,744 ms with `SERVER_FILES_UNAVAILABLE`. Existing logs do not prove its
  precise failing phase. A separate preceding operator list failure receipt
  reports missing nonce readback; do not conflate the two requests.
- 18:19:29Z: another browse refusal in 82 ms.
- Real UI open → close during load → reopen returned C/Y at 18:23:47Z.
  Broker request 29d25bca-7fd0-46b9-9002-013bac888741 completed in 17,875 ms.
  Two browser HTTP requests shared one source operation: coalescing worked.
- Navigating into C then reproduced busy. At 18:24:11Z the real source-lock
  holder was `knowledge-inventory.py`, PID3832473, parent systemd. No orphaned
  lock was established. No lock was removed and no holder was killed.

## Cause and change

Live demand set `interactive-until`, but the default browser used nonblocking
source-lock acquisition. If a background page held the lock, the user request
failed immediately and cleared demand in `finally`. The background worker
checks demand between pages, so it commonly never saw that brief signal.

The interactive broker now waits at most55 seconds for source admission while
its demand marker remains set. Background browse remains nonblocking. A live
request leaves15 seconds of navigation grace after completion, then the marker
expires and background work resumes. It does not interrupt the current page or
rebuild the local catalogue. Supported reads retry only a source-lock refusal
that happened before the CLI opened Windows; a dispatched operation, timeout or
uncertain result is never retried.

Browse records fixed phase enums and millisecond timings for source admission,
RDP startup and nonce readback. Broker logs correlate these with requestId. No
source path, clipboard data, generated command or credential is logged. A proven
nonce-readback timeout becomes `SERVER_FILES_TIMEOUT`, not a claim that the
folder does not exist. This instrumentation does not itself fix clipboard
transport; the next actual attempt must establish whether that remains a blocker.

Waiting for an active background page may still take tens of seconds. This
hotfix addresses immediate busy/starvation, not the unachieved cold/warm target.
Do not claim a permanent fix or successful file selection until live QA passes.

## Exact host installation — exclusive release owner

Install only these three reviewed files into
`/usr/local/lib/aibrain/server-files/`:

- `rdp-server-files-broker.py`
- `rdp-server-files.py`
- `knowledge-folder-inventory.py`

No changes are needed to the Windows helper, sync/inventory services, credentials,
access manifest, roots or systemd ExecStart. Do not install/enable 5fee4ff as part
of this hotfix. App image release is a separate gate; it does not install these
host files.

Stage all three, verify their commit hashes, and preserve mode/owner plus
per-file reversible backups. Coordinate a brief pause in Server QA and verify
the existing broker has no active request children before restarting only
`aibrain-arnall-server-files` around the replacement. If a request is active,
wait for its natural completion; do not kill it or the source-lock holder. Leave
scheduled sync/inventory and Windows sessions running. Read back all three
hashes, service health and unchanged default ExecStart before resuming QA.

Rollback uses only those three known backups after the same idle check and
broker-only restart. Do not delete `.operator.lock`, reset the inventory,
change ACLs or remove customer files.

## Local validation and remaining live gate

57 Python RDP/Server tests passed. Knowledge slice: 220 tests, 11 environment
skips, all runnable tests passed. New cases cover delayed admission followed by
exactly one source execution, unchanged nonblocking background admission,
retrying only refused read admission, bounded wait, and sanitized nonce-timeout
phase; the demand test verifies15-second grace and expiry.

After host installation, repeat the actual UI open/close/reopen, C→Arnall→work
folder navigation, select/deselect an existing supported file without sending,
and recovery after refusal/failure. Keep the user's draft unchanged. Correlate
one request ID with sourceWaitMs/sessionStartMs/readbackMs and no duplicate source
execution. UI shortcuts can use existing queries `server:/C/Arnall/Compres` and
`server:/C/Arnall/Vendes`, configured only for Arnall and checked through the
normal endpoint. Keep access to other authorized roots rather than hiding them.
