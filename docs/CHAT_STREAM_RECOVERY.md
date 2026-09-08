# Composer and response recovery

The client treats transport loss separately from a durable terminal turn result.
The chat request keeps its original thread, user-message and assistant-message
identity across retries. Server admission, authorization and effect deduplication
remain authoritative; the client never creates another turn to recover a response.

Each connection has a 40-second opening deadline and a 45-second silent-body
watchdog (the server sends 15-second keepalives). A terminal event finishes the
reader immediately. Quiet streams with keepalives remain attached, including
long document work; this is not a turn execution deadline. Reconnection backs
off from one to eight seconds, with at most eight automatic retries and a
90-second recovery window. Exhaustion pauses recovery and preserves the local
request and saved response. The user can reconnect explicitly; a browser online
event also resumes the same request. A transport/auth failure after uncertain
admission cannot turn an accepted response into a fabricated failure.

Soft server-component refreshes preserve the attached turn and current selection.
Initialization runs once per mounted user identity; a full page reload still opens
the landing page.

After reload, selecting a saved streaming conversation reconciles the exact
thread/project/assistant identity through read-only snapshots for up to 60
seconds. Reads have an eight-second deadline. Forbidden or missing records pause
immediately. Manual retry or restored connectivity opens another bounded window.
The runtime availability probe is independently capped at three attempts;
background retries leave an unavailable state instead of an endless spinner.
Late responses from a previous project are ignored.

Tool mentions remain native textarea text with a decorative, noninteractive
overlay. Selected tool IDs follow complete readable mentions in the current
text, including paste, replacement, undo and draft restoration. Partial deletion
removes the hidden selection. Recurring menus use their trigger's coordinates
and actual rendered height with visual-viewport resize/scroll adjustment.
Server is labelled Experimental; its transport and permissions are unchanged.

## Validation

`playwright.recovery.config.ts` uses local filesystem demo mode so browser tests
exercise the installation catalog path, which the Vercel browser-only preview
intentionally skips. Its Chromium suite covers viewport/zoom menu geometry,
native editing and a real HTTP cut/restoration against an isolated durable turn
fixture with one recorded effect. Its iPhone WebKit suite covers native editing.
Backend CI runs these after the existing chromium-1 and WebKit suites; both are
required by the existing E2E aggregate. Unit/component tests exercise deadlines,
manual pause/resume, quiet keepalives, stale-project exclusion and scoped reads.
Existing server disconnect and worker crash/restart tests remain required.

Local and fixture tests are separate from authenticated acceptance after immutable
publication/deployment to each installation. A passed fixture is not evidence of
real provider access or customer-side effects.
