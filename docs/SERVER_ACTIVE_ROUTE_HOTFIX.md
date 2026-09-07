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

## Post-installation evidence and next bounded change

The release owner installed4fc4d5b's three files; independent hash readback
matched broker f9cd58e4d241e49526559f85c6e67467ba2b3b43cf1a0f2d995de24f5ceb0e4d,
files4d7f0ce24747a02f67ad1d2a00d91ca178ee00bf54c79b6bd75770326d91f379 and
folder39606385ddf1111f175752e02a4a257f7ffb55174e3f39b1aeb299706ff7d4d9.
Backup: `/usr/local/lib/aibrain/server-files/pre-4fc4d5b-20260907`.

Real C listing after retry succeeded18:34:18Z, request
ab6f4d3c-a7c0-4003-beaa-986466f80b4b, total19,181ms: source wait0,
startup16,020ms, readback2,801ms. A subsequent folder request
6103164b-5ef8-43d9-aae1-5b3ce7da07f8 failed18:36:03Z after63,987ms:
source wait4,253ms, startup12,672ms, readback46,924ms with
`RDP_READBACK_TIMEOUT`. Another simultaneous root request was refused by the
broker's one-operation slot. Priority now lets a queued source operation proceed;
it does not fix unreliable nonce/clipboard delivery or all concurrent callers.

The follow-up candidate adds a second response sink to the **same execution**:
nonce-bound JSON written atomically with CreateNew into this invocation's
private redirected Hetzner job. Clipboard remains supported when redirection is
unavailable. A clipboard subprocess timeout no longer discards a file response.
Only owner-private regular single-link files ≤256KiB matching the current nonce
are accepted. No operation is resent, no Windows disk is written, and no
persistent bridge is activated. This candidate changes `rdp-access.py` and
`rdp-server-files.py` together; do not install only one. The broker also logs source completion when an app restart has already closed
the response socket, with delivered=false and no sensitive payload. Include
rdp-server-files-broker.py in this installation. This follow-up is **not
installed or live-tested** under the later no-deploy instruction.

64 RDP/Server tests passed, including6 new readback cases and disconnected-client logging; generated browse/copy
PowerShell parsed successfully using PowerShell7.6.5. Windows PowerShell5 live
acceptance is still required after the coordinator installs the reviewed files.

## Recent conversation: distinct continuity evidence

App thread63bc3cb6-fdb0-4bd1-abdc-82a16e6e393f, assistant message
787040b4-4a6c-40ef-8439-dabb325d2348, runtime turn
01a07d28-4f7a-7e60-9607-a97570d729b6:

- First tool query `server:/` completed from metadata.
- Second `live:server:/C/` completed18:37:14.149Z with real C metadata.
- Third `live:server:/Y/`, call exec-2fbe5460-43b4-47bf-8b53-bc22c1959168,
  remains `running` in the persisted projection.
- Projection stopped at sequence21580, updated18:37:15.203Z; both gateway/client
  journals contain later events through21631 and a waiting commentary completed
  at18:37:27.549Z. No matching terminal `turn/completed` was found in that journal.
- Release ea80913 was promoted18:37:19.751Z. The timing establishes an interrupted
  consumer/projection around restart, not a complete causal proof of every UI
  failure. No history, token or stored turn was reset.
- «Fuentes1» expands to `image.png — Archivo adjunto`. It is not empty, but it is
  the user's uploaded screenshot, not a verified Windows document citation.

Continuity/recovery owner should inspect
`src/runtime/workers/local-gateway-runtime.ts`,
`src/runtime/worker-codex-turn.ts`,
`src/workbench/turn-projection-store.ts` and the preserved per-user app transport
journal for the pending tool reply and terminal projection. Do not replay
arbitrary side effects or attribute this to the microphone. The successful C
partial tool result is preserved; a complete recovered answer is not accepted.

## Fresh business-root evidence, metadata only

Authorized app API checks on live ea80913:

- C:\Arnall at18:52:35.882Z: exactly Compres and Vendes, no pagination/limit;
  total36,350ms (source1,251ms, startup24,704ms, readback9,890ms).
- Y:\ at18:53:17.338Z: first page49 visible entries, limited with offset50 next
  page. Actual directories include COMPRES, COMPTABILITAT, ERP and FACTURES
  PROVEIDORS2022–2026. Total19,000ms (source0, startup16,112ms, readback2,295ms).

These results establish real directory names. They do not establish each
folder's function or that Y contains every useful document. No document content
was opened, file executed, source changed or extension-based hiding applied.
