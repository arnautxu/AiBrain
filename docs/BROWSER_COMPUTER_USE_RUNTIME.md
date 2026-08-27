# Browser and Computer Use runtime

## Scope

This module launches an isolated headless Chrome/Chromium process per employee,
keeps CDP on an ephemeral loopback port and exposes only an authenticated,
same-origin PNG viewer and bounded input contract. The browser client never
receives a CDP endpoint.

The implementation lives in `src/runtime/browser`, is installation-aware,
user-scoped and filesystem-backed, and is wired through
`/api/runtime/browser`, `/token`, `/viewer/frame` and `/viewer/input`.

## Per-user durable layout

`BrowserSessionStore` derives every path from the versioned
`InstallationConfig` and the canonical user UUID. It delegates initial root
creation to `WorkerProvisioner` and then revalidates real paths and rejects
symlinks.

```text
<usersRoot>/<userId>/browser/
├── profile/       # exclusive browser profile for this user
├── downloads/     # exclusive download root for this user
├── session.json   # private schemaVersion=1 lifecycle/download metadata
└── .locks/        # cross-process state mutation locks
```

`session.json` is written with mode `0600` using atomic temp/fsync/rename
writes. Directories are `0700`. Reads validate the complete schema,
installation/user binding, lifecycle invariants and download basenames. A
corrupt, foreign, over-sized, hard-linked, permissive or symlinked state fails
closed. Valid interrupted atomic writes can be recovered by the shared storage
primitive.

The browser profile itself is intentionally opaque to AiBrain. Chrome receives
only that employee's profile and download roots. Download metadata records only
a safe basename, status and size; it never stores an arbitrary path.

## Lifecycle and fencing

The durable states are:

```text
stopped -> starting -> ready -> human-control
                ^       |             |
                |       v             v
                +--- recovering <-----+
                         |
                         v
                       ready

runtime failure -> degraded -> recovering
```

- `ready` is agent-controlled.
- `human-control` pauses automation and requires human heartbeats.
- releasing takeover or losing a heartbeat enters `recovering` with no
  controller.
- completing recovery returns control to the agent.
- a runtime failure enters `degraded` with no controller.
- `stop` removes the active browser session binding and records whether the
  profile closed cleanly.

Every recovery rotates `browserSessionId`. This fences old viewers, gateway
tokens, heartbeats and pre-restart process handles. Recovery also increments
the runtime generation and records its reason and attempt count.

## Authenticated private gateway token

`BrowserGatewayTokenService` issues HMAC-SHA256 tokens with a maximum five
minute lifetime by default. Claims are bound to:

- token audience and version;
- installation ID;
- user UUID;
- current browser session UUID;
- SHA-256 binding of the opaque local auth session;
- explicit `view`, `control`, `heartbeat` and/or `takeover` capabilities;
- issue and expiry timestamps.

The raw local session ID is never embedded in the token. Verification checks
the signature in constant time, exact payload shape, lifetime, all bindings and
the required capability. The gateway must additionally resolve the current
local session and current browser state before accepting a connection or
action. Logout/disable therefore remains authoritative, and browser-session
rotation invalidates previously issued tokens.

Tokens and signing secrets are never logged or placed in query strings. The UI
obtains a token through the authenticated exchange and presents it only in the
`Authorization` header of frame/input requests. Input additionally requires a
current human takeover in durable state.

## Registry and backpressure

`BrowserRuntimeRegistry` owns at most one runtime object per user in the Node
process and rejects a factory that reuses a runtime object. Starts are
coalesced per user and pass through a bounded concurrency gate. Saturation
returns `BrowserRegistryBackpressureError` with a retry delay instead of
creating unbounded processes or waiters.

On a backend restart, a fresh registry detects durable active state, enters
recovery, rotates the session binding and asks the adapter to start with
`recovering=true`. Profiles and downloads remain user-specific and durable.

The registry is process-local. The adapter closes a child with `Browser.close`
and only escalates signals against the exact process it launched. On restart it
validates the private `DevToolsActivePort`, version and loopback endpoint, closes
the prior orphan through CDP, waits for profile release and then starts a new
process. It never kills a PID recovered from disk.

## Chrome/CDP boundary

`ChromeCdpRuntime` uses an allowlisted CDP client with bounded frames, pending
commands, listeners and timeouts. It validates the PNG signature/size, URL
schemes and input dimensions. Launch arguments bind remote debugging to
`127.0.0.1` with port `0`; `--no-sandbox`, shell execution and `docker.sock` are
forbidden.

Production requires `AIBRAIN_CHROME_EXPECTED_VERSION` with all four version
components. Use a pinned Chrome for Testing/Chromium artifact rather than a
user's auto-updating desktop Chrome. `AIBRAIN_CHROME_BIN` selects the server
executable. `AIBRAIN_BROWSER_GATEWAY_SECRET` must be a dedicated secret of at
least 32 bytes.

## Remaining browser work

The browser checkpoint stays open until these plan requirements are added and
validated:

1. bind gateway tokens and page targets to an owned thread;
2. route each target's downloads into that thread's staging and validate them;
3. add the closed agent tool and durable approvals for sensitive external acts;
4. block private, loopback and cloud-metadata destinations in production;
5. add target/tab lifecycle operations without exposing arbitrary CDP;
6. place each browser service behind the dedicated private container/network
   boundary and prove it cannot see another employee's roots;
7. add crash-loop, memory and CPU operational probes.

## Focused validation

Run:

```bash
npx vitest run src/runtime/browser/browser.test.ts
npx vitest run src/runtime/browser/cdp-client.test.ts src/runtime/browser/chrome-runtime.test.ts
npx eslint src/runtime/browser
```

The focused suite covers two-user root and state isolation, durable restart,
download state, takeover and heartbeat recovery, stale-session fencing,
gateway token tampering/cross-user/expiry checks, registry runtime exclusivity,
restart recovery, bounded start backpressure, corruption and symlink rejection.

The real two-profile test is opt-in because it launches three browser
processes. Point it at a pinned Chrome for Testing/Chromium build:

```bash
AIBRAIN_CHROME_EXECUTABLE=/opt/aibrain/chrome/chrome \
AIBRAIN_CHROME_EXPECTED_VERSION=152.0.7977.64 \
npm run test:browser:real
```

It proves different loopback ports, targets, profiles, cookies and download
roots for two employees, then reopens one profile and verifies its persistent
cookie without exposing the other employee's state.
