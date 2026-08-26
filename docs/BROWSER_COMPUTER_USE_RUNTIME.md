# Browser and Computer Use runtime foundation

## Scope

This module provides the server-side isolation and lifecycle contract required
before attaching Chrome, CDP or an authenticated noVNC viewer. It deliberately
does not launch a browser and does not expose a UI.

The implementation lives in `src/runtime/browser` and is installation-aware,
user-scoped and filesystem-backed. A real browser adapter must implement
`BrowserRuntimeFactory` and `ManagedBrowserRuntime`; it must not weaken the
roots or session checks defined here.

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

The browser profile itself is intentionally opaque to AiBrain. Cookies,
storage and tabs will remain inside the per-user `profile/` when the concrete
browser adapter is added. Download metadata records only a safe basename,
status and size; it never stores an arbitrary path.

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
- explicit `view`, `heartbeat` and/or `takeover` capabilities;
- issue and expiry timestamps.

The raw local session ID is never embedded in the token. Verification checks
the signature in constant time, exact payload shape, lifetime, all bindings and
the required capability. The gateway must additionally resolve the current
local session and current browser state before accepting a connection or
action. Logout/disable therefore remains authoritative, and browser-session
rotation invalidates previously issued tokens.

Tokens and signing secrets must never be logged or placed in query strings.
The concrete viewer should receive them through an authenticated server-side
exchange and use a private WebSocket/subprotocol or authorization header.

## Registry and backpressure

`BrowserRuntimeRegistry` owns at most one runtime object per user in the Node
process and rejects a factory that reuses a runtime object. Starts are
coalesced per user and pass through a bounded concurrency gate. Saturation
returns `BrowserRegistryBackpressureError` with a retry delay instead of
creating unbounded processes or waiters.

On a backend restart, a fresh registry detects durable active state, enters
recovery, rotates the session binding and asks the adapter to start with
`recovering=true`. Profiles and downloads remain user-specific and durable.

The registry is process-local. Production must ensure only the designated
per-user browser service owns the actual Chrome process. The current state
fencing prevents a stale process from mutating the new browser session, but it
does not itself kill an orphan OS/container process.

## Concrete adapter checklist

Before enabling Browser/Computer Use in production, the adapter and gateway
must add and validate:

1. a pinned Chrome/Chromium build and isolated process/container per user;
2. private CDP, never exposed to the browser client or public network;
3. authenticated noVNC/viewer transport using the gateway token contract;
4. automation pause before takeover and recovery before agent control resumes;
5. download containment and post-download MIME/archive validation;
6. process ownership/lease enforcement and orphan termination;
7. health probes, memory/CPU backpressure and crash-loop limits;
8. integration tests with two real browser profiles proving cookies, tabs,
   downloads and viewer sessions cannot cross users.

## Focused validation

Run:

```bash
npx vitest run src/runtime/browser/browser.test.ts
npx eslint src/runtime/browser
```

The focused suite covers two-user root and state isolation, durable restart,
download state, takeover and heartbeat recovery, stale-session fencing,
gateway token tampering/cross-user/expiry checks, registry runtime exclusivity,
restart recovery, bounded start backpressure, corruption and symlink rejection.
