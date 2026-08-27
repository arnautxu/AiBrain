# Browser and Computer Use runtime

## Scope

This module launches one persistent headless Chrome/Chromium process per
employee. Chrome DevTools Protocol is carried only over the process's inherited
file descriptors 3 and 4 using `--remote-debugging-pipe`: there is no CDP TCP
listener, discovery URL or `DevToolsActivePort` file. The web application
exposes only an authenticated, same-origin PNG viewer and bounded input
contract. The browser client and employee App Server never receive a CDP
endpoint or file descriptor.

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
- owned workbench thread UUID;
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
and only escalates signals against the exact process it launched. A lost pipe or
child causes the owned runtime to be fenced and relaunched against the same
private profile; it never discovers or kills a PID recovered from disk.

## Chrome/CDP boundary

`ChromeCdpRuntime` uses a NUL-framed, strict-UTF-8, allowlisted CDP client over
the inherited pipe. Frames, pending commands, listeners and timeouts are
bounded. Responses and events are routed by CDP `sessionId`. Each workbench
thread receives its own attached page target (up to the configured per-user
backpressure limit); the browser profile and cookies remain intentionally
shared only between threads of that same employee.

Downloads first land under a GUID in a private per-user quarantine. Target-
scoped Page events bind the GUID to an owned thread, after which the completed
file is atomically promoted to that thread's private download directory. A
restart cleans bounded orphan quarantine entries rather than assigning them to
an arbitrary thread. The adapter validates PNG signatures/sizes, URL schemes
and input dimensions. Network CDP flags, `--no-sandbox`, shell execution and
`docker.sock` are forbidden.

Production requires `AIBRAIN_CHROME_EXPECTED_VERSION` with all four version
components. Use a pinned Chrome for Testing/Chromium artifact rather than a
user's auto-updating desktop Chrome. `AIBRAIN_CHROME_EXECUTABLE` selects the server
executable. `AIBRAIN_BROWSER_GATEWAY_SECRET` must be a dedicated secret of at
least 32 bytes.

## Operational browser boundary

The agent receives only the closed browser tool namespace and sensitive
mutations require durable, replayable approval. Chrome egress crosses a
private loopback proxy: DNS is resolved once under `BrowserNetworkPolicy`, all
answers must be globally routable, and the socket connects to the pinned IP.
Only TCP 80 and 443 are allowed by default for absolute HTTP and CONNECT; a
different bounded server-side allowlist must be explicit and is never chosen
by the browser/UI.

CDP target discovery closes popups, service workers and pages not owned by the
active thread creation. Production launches Chrome inside the employee bwrap
filesystem namespace, masking other profiles, source and publish roots. The
remaining validation is host-specific: exercise bwrap/seccomp/Chromium and
resource probes inside the immutable QA image.

## Focused validation

Run:

```bash
npx vitest run src/runtime/browser/browser.test.ts
npx vitest run src/runtime/browser/cdp-client.test.ts src/runtime/browser/chrome-runtime.test.ts
npx eslint src/runtime/browser
```

The focused suite covers two-user root and state isolation, durable restart,
thread-bound targets and downloads, takeover and heartbeat recovery,
stale-session fencing, gateway token tampering/cross-user/thread/expiry checks,
registry runtime exclusivity, private-pipe framing and EOF recovery, bounded
backpressure, corruption and symlink rejection.

The real two-profile test is opt-in because it launches three browser
processes. Point it at a pinned Chrome for Testing/Chromium build:

```bash
AIBRAIN_CHROME_EXECUTABLE=/opt/aibrain/chrome/chrome \
AIBRAIN_CHROME_EXPECTED_VERSION=152.0.7977.64 \
npm run test:browser:real
```

It proves no Chrome TCP listener or `DevToolsActivePort`, separate targets,
profiles, cookies and download roots for two employees, same-user thread target
and download routing, forced pipe EOF recovery, and reopening one profile with
its persistent cookie without exposing the other employee's state.
