# Optional private Server transport

Status (2026-09-07): implemented offline, **disabled and not accepted live**.
This is shared AiBrain infrastructure, not an Arnall product fork. No service,
Windows account/ACL, firewall, customer document or installation configuration
was changed by this commit. Existing deployments keep the existing transport.

## Opt-in and evidence boundary

The Server broker accepts optional `--transport-config <root-private-json>`.
Without it, the existing subprocess/RDP path and its concurrency remain intact.
With it, live browse and supported reads use a bounded RDPDR channel over the
existing certificate-pinned encrypted RDP connection. Search/catalogue operations
retain their existing implementation. There is no new TCP listener, public port,
Windows installation or arbitrary-command endpoint.

The opt-in JSON has exactly these fields:

```json
{
  "schemaVersion": 1,
  "mode": "rdpdr",
  "installationId": "installation-id",
  "connectionId": "connection-id",
  "identityEvidenceFile": "/absolute/root-private/identity-evidence.json"
}
```

The separate root-private evidence JSON requires the same installation and
connection IDs, `accountSid`, `dedicatedSession: true`,
`readOnlyAclVerified: true`, `assessmentId`, and `policyFingerprint`. The latter
is the SHA-256 returned by `fingerprint(config, credentials, access)` after loading
those exact private inputs. A configuration/credential/access change invalidates
the assessment and the running channel. Never log the inputs, credentials or
fingerprint generation material. The assessment identifier must refer to actual
administrator evidence of a dedicated, exclusive session and read-only Windows
ACLs for the approved roots. **Filling in booleans is not that evidence. A username
is not evidence either.** The helper independently checks its Windows SID against
the assessed SID and rejects an administrator token before serving requests.

Arnall does not yet have that verified assessment. Do not create the opt-in files
or enable its persistent channel until it does. MODTIME and other installations
have independent manifests and cannot inherit an Arnall transport or credential.
An opt-in configuration for a foreign installation is rejected before connection.

## Bounds and freshness

- Four concurrent operations, no unbounded wait queue or completed-list cache.
  Every request rechecks publication ownership and the current policy/evidence;
  the app still independently checks the current user's resolved resource roots.
- Windows program remains in memory and reads its hash-verified fixed program
  from the private job on the redirected Hetzner drive. Commands are signed JSON
  data, never user-provided PowerShell. Nonce/unique request ID and HMAC-SHA256
  prevent cross-session replies, modified frames and reply replay.
- The helper uses four runspaces, BelowNormal priority, a 256 MiB memory guard,
  90-second lifetime, cancellation requested after 30 seconds per worker and at most 120 observed
  requests. The host stops admission at 50 seconds or 110 requests and retires
  an idle channel after 15 seconds. It does not prewarm at service startup.
- A page contains at most 50 entries. Enumeration examines at most 50,001
  entries and reports a limit rather than claiming full coverage beyond that
  bound. Offset pagination uses freshly read sorted metadata; external edits
  between pages can move entries, as with any fresh offset listing.
- Reads export fresh supported documents only, at most the existing 16 MiB
  policy limit. CreateNew targets are generated under the host's private import
  job. Copies do not lock out an employee writer; size/time/hash version changes
  reject the copy. Windows and host SHA-256 must agree before the existing
  sandboxed extractor can use the result. No original Windows file is changed.
- Unsupported executables return `SERVER_FORMAT_NOT_READABLE` before session
  startup. Source changes, byte/time limits, unavailable paths, timeouts, policy
  changes and an uncertain stopped session remain distinct errors. Reference
  turn handling already preserves the prompt and other valid references.

This can remove per-click startup while the channel is alive. It does not remove
RDP cold startup or prove a 1-second warm target. The earlier ephemeral prototype
measured individual lists 1.665–1.741 s and four-request batches 4.694–5.122 s;
those are **not measurements of this new implementation or four app users**.

## Exclusivity, shutdown and recovery

A live channel holds the existing `.operator.lock`. Before opening it, it creates
`.read-channel-lease.json` in that connection's private import root. All RDP
callers must use the updated `RdpSession` guard: a foreign job is refused while
this marker exists. The marker never expires merely because time passed.

Successful signed `done.json` for the same nonce permits removal of only our
marker after closing our own local FreeRDP/Xvfb processes. An uncertain timeout,
bootstrap failure or broker crash retains the marker. There is no automatic
fallback or replay after dispatch. A next request can create a new session only
after clean shutdown; otherwise it fails closed with quarantine.

After a broker crash, the root recovery command is:

```text
python3 rdp-read-channel.py --manifest <installation-server-files.json> --recover-stopped
```

It takes the source lock, validates the exact existing lease/job, authenticates
that job's final `done.json` using its private ephemeral key and only then clears
our marker. It does not connect to Windows or kill any session. Missing, invalid
or foreign receipts leave quarantine intact. Never manually delete a lock or
clear the marker just because a timeout elapsed. If no valid stopped receipt
exists, the administrator must establish the state of the dedicated session.

## Coordinated host installation gate

Application main/push does not install these host Python/PowerShell files.
Before enabling this on any installation, its exclusive release owner must:

1. Verify actual dedicated identity/session and read-only ACL evidence, approved
   roots, RDPDR availability, and an isolated QA fixture. No employee impersonation.
2. Install matching `rdp-read-channel.py`, `.ps1`, `rdp-channel-lease.py`, broker and
   guarded `rdp-access.py` together. Inventory **all** existing RDP module copies
   and update their guard plus sibling lease helper before enabling the channel;
   otherwise a legacy sync could bypass crash quarantine. For the previously
   inspected Arnall host these included top-level, knowledge and server-files
   copies. Verify checksums and preserve reversible backups.
3. Do not restart an active broker operation, sync, inventory or employee session.
   Configure only this installation's broker; do not change global firewall,
   Windows accounts/groups/ACLs, RDP settings or customer data.
4. Run the Windows-specific tests on the dedicated account: SID/token rejection,
   read copy/hash, changed source, pagination, invalid paths/reparse, timeout,
   disconnect, confirmed stop and quarantine/recovery. These gates remain pending.
5. Verify 2 then 4 real authorized QA identities through the app, including
   negative cross-user/cross-tenant access and original preservation. A unit test
   with four threads is not live multiuser acceptance.
6. Measure actual cold/warm end-to-end p50/p95, resource usage, reopen/recovery and
   background sync fairness. The short lease can still make legacy sync busy;
   do not accept it until those measurements satisfy the user's requirements.

Rollback: remove the explicit opt-in argument after a confirmed stop, preserve
all copies/receipts, verify no quarantine and resume the previous broker path.
Do not run two transports or remove an uncertain-session marker to force rollback.

## UI and release status

Main at the start of this work contained 3057eb79, 41bd4208 and 3bcfd21f: popup
portal, drive labels, focus restoration, partial reference errors, request
coalescing and independence from catalogue rebuilding. This change does not edit
the UI owner's composer files. Primary work-folder shortcuts (Compres/Vendes)
and user choice of roots are coordinated separately; the transport never narrows
or invents roots. Release owner is responsible for merge, CI, image publication,
host installation and per-installation live verification as separate gates.

## Offline validation for the handoff

- Python RDP/Server slice: 75 tests passed, including 23 new channel tests.
- PowerShell 7.6.5 parser on macOS: fixed program syntax passed; Python↔PowerShell
  HMAC/Unicode round trip and the CreateNew copy constructor passed using only
  our own local synthetic files. This does not establish Windows PowerShell 5
  runtime compatibility or real Windows read/copy acceptance.
- No new Windows session, persistent bridge, host installation or deployment.
  Source baseline was 3bcfd21f; remote main was refreshed to 8fcf246f before
  handoff. The UI release proceeds independently under its exclusive owner.

Integration with the active-route admission fix: when no channel is configured, browse/read retain the bounded interactive wait and navigation grace from 4fc4d5b. Opt-in calls alone use channel.browse/channel.copy. Sanitized phase diagnostics and timeout classification are preserved. No production channel configuration is enabled by this integration.
