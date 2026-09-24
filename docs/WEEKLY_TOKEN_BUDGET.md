# Installation weekly token budget

Arnall activated on 2026-09-24 at 12:23:14 Europe/Madrid (10:23:14 UTC).

Arnall's selected policy is **7,500,000 total tokens per week**, shared by all
employees. Cached input is included exactly once. Reasoning output is already
part of output and is not added again. This is an internal token budget, not a
percentage of a ChatGPT subscription or a billing estimate.

The week starts Monday 00:00 in `Europe/Madrid` and ends at the next Monday,
including daylight-saving transitions. In-app notices occur at 25% (1,875,000),
50% (3,750,000), and 75% (5,625,000); exhaustion remains visible with the reset
time. Notices are scoped to the signed-in user, installation and week. The
counter is shared, not a separate allowance for each employee.
Employees see only the remaining percentage and reset time. Raw token totals,
the numerical allowance and the connected account's subscription usage are
private operator data and are omitted from employee API responses and settings.

The privacy boundary also applies to model tools. The outer worker sandbox
hides the operator installation configuration and transport audit journals.
Quota-enabled turns use named filesystem profiles that hide Codex runtime
usage metadata while retaining access to managed skills and the existing project
write scope. Read-only turns remain read-only. Native sandbox/permission
escalation is unavailable under the quota policy, so an employee approval
cannot expose the private counters. Separate application browser/connector
approvals are unchanged. Worker restart is required when enabling the policy
to discard any previous process/session permission grants.
The profiles are supplied at worker startup, because the pinned App Server
reloads named profiles from its base configuration when changing turn modes.
Tool commands retain only the current project's existing write root and the
same temporary-directory grants. The private paths are non-overlapping session,
log, history and SQLite-family rules: broad parent-directory denies break the
pinned Linux helper, and overlapping directory/glob denies can prevent startup.
Keep this physical Linux compatibility check when upgrading the pinned runtime.

## Configuration and accounting

The root-owned installation configuration accepts:

```json
"usageLimits": { "weeklyTokens": 7500000, "timeZone": "Europe/Madrid" }
```

Omitting this property preserves existing installations' behavior. Unknown
keys, invalid counts and unsupported time zones are rejected. Employees cannot
change this policy through prompts, company files, UI input or preferences.
The Arnall example includes the chosen policy; examples do not mutate the live
installation configuration.

State lives in `dataRoot/usage/weekly-token-budget.json`, under an installation
lock shared across application and automation processes. Atomic writes preserve
daily totals, thread cursors and deduplication evidence across restarts. Missing,
corrupt or uncertain state blocks inference, rather than creating free allowance.
If a tracked turn completes successfully without any usage evidence, new
inference pauses for a two-second grace period. If usage still does not arrive,
the ledger requires operator reconciliation.
The accounting source is `thread/tokenUsage/updated` cumulative totals, not the
legacy chat journal's last response count. Admission covers chat, scheduled
tasks, horarIA and steering in the shared runtime client. Reading conversations,
stopping tasks and recovering an already-started turn stay available.

A stopped or failed turn may end before the provider reports any token usage.
That absence does not disable the installation; a delayed cumulative report is
still counted. A successfully completed turn without usage evidence remains
blocked after a short grace period, as do malformed reports or persistence
failures. The budget accounts for provider-reported consumption, including late
reports, rather than guessing charges for interrupted requests.

New starts and steering are denied once the measured total reaches the budget.
Active turns are interrupted when accounting or periodic shared-state checks
observe exhaustion. **This is not a mathematically exact provider-side ceiling:**
the provider reports tokens after consumption, concurrent requests can already
be in flight, and interruption takes time. A small or larger final request can
exceed the remaining amount; all reported excess is retained in the counter.
The pinned protocol has no per-request maximum-token reservation mechanism.

The separate host knowledge-generation adapter does not expose a durable meter
to this ledger. Its execution entry point now reads the canonical installation
configuration and refuses execution whenever `usageLimits` is present, before
credentials or model dispatch, and rechecks before every step. Preview remains
available. Install that host script during the same authorized rollout and keep
its service stopped until the guard is verified. Do not claim installation-wide
enforcement if an old host adapter or an unaccounted standalone process runs.

## First activation and history seed

On **2026-09-24**, the user explicitly chose a fresh initial allowance starting
at activation, with only the remaining percentage visible to employees. Use
`--start-now` for this first Arnall activation: exclude all consumption before
the offline capture, including earlier consumption that day, and start with the
full 7,500,000-token allowance. This is an authorized initial policy boundary,
not a deduction from or estimate of the connected account's subscription.

The initializer still imports the latest verified cumulative cursor for every
logged user/thread, so resuming an existing conversation charges only its later
increments. It persists the real capture timestamp as `initializedAt`; earlier
usage replay is excluded and must not produce a new lifecycle-accounting error.
Historical ephemeral usage does not reduce this expressly fresh allowance.
All old ephemeral workers must be stopped, and a later report from an unknown
existing thread without a trustworthy baseline remains blocked for reconciliation.

1. Complete the normal Backend CI, GHCR and deployment gates for the candidate.
   Promote the private configuration containing `usageLimits` through the
   versioned release manager, using the same tested images and revision. Do not
   edit the active configuration behind the release-state fingerprint. Missing
   budget state blocks inference while this activation is being completed.
   Stop/drain the app, automation, horarIA and knowledge model workers before the
   initial seed. No old, unmetered runtime may continue during activation.
2. With the configured workers stopped, run
   the candidate's packaged initializer with the same config/data/users mounts,
   as the application UID. First inspect its **read-only** summary:

   ```sh
   node /usr/local/share/aibrain/initialize-weekly-token-budget.mjs --offline --start-now
   ```

3. Verify `initializationPolicy: "start-now"`, zero `recordedTokens` and the real
   `countingStartsAt` capture time in the private preview. Initialize once:

   ```sh
   node /usr/local/share/aibrain/initialize-weekly-token-budget.mjs --offline --start-now --apply
   ```

   Local source equivalent: `npm run usage:initialize-budget -- --offline --start-now [--apply]`.
   The initializer reads only this installation's private workers' session and
   archived-session metadata/token events. It preserves the latest counters and
   deduplicates active/archive copies. Start-now does not require reconstruction
   of excluded legacy consumption, but rejects symlinks, malformed counters,
   future events and files modified during inspection. Keep workers quiesced
   throughout capture and initialization. It prints a private operator summary
   with counts and policy metadata, without conversation text or credentials.
   It refuses to replace an existing budget ledger, including with `--start-now`.

4. Start the candidate workers. Verify authenticated `/api/usage/budget` returns
   **100% remaining** and the Madrid reset time without exposing token counts or
   calling a provider. Verify a foreign/missing session cannot read it. Check
   the exact private allowance, zero charged history and preserved cursors only
   through operator readback. The first post-activation increment must reduce the
   shared balance; pre-activation replay must leave it unchanged. Use fixtures
   for the three warning thresholds and exhausted-admission behavior.
5. Record host-script checksum, configuration/ledger readback, exact release SHA,
   and authenticated browser acceptance independently of CI/publish/deploy.

Without `--start-now`, the default remains a conservative legacy-history import.
Legacy session logs may omit ephemeral horarIA/knowledge consumption, so that
mode permits application only when the measured lower bound already exhausts
the week. A lower total requires complete reconciliation; it must not silently
grant allowance. The earlier read-only finding of roughly 15.50 million tokens
is historical evidence, not the amount charged by this authorized fresh start.

A weekly reset changes the displayed period; it must not delete thread cursors
or replay evidence. Never delete/reseed the ledger as a routine reset or recovery.
Investigate an unavailable/reconciliation state with all model workers stopped.
Disabling the installation policy removes the budget and requires an explicit
operator decision; rolling back to code without quota enforcement also removes
its protection and must not be described as retaining the limit.

## Candidate validation (2026-09-24)

- Typecheck, repository lint, production Webpack build, both server executable
  bundles, generated Codex contracts and infrastructure validation passed locally.
- The final complete local suite passed 1,667 tests with 23 skipped (303 passing
  test files, eight skipped). The focused runtime, fresh-start history,
  employee privacy, UI and contract checks passed, as did 24 host generation
  tests and the multi-user worker acceptance/release-manager slice.
- Local rendering with actual BrainApp/CSS at 1440, 390 and 320 pixels kept the
  composer visible without overflow; the percentage-only budget strip passed
  axe in both themes, and visible text exposed neither token counts nor the cap.
  These were synthetic sessions, not authenticated live acceptance.
- A read-only capture of token metadata from the live host's 279 session files
  passed the packaged initializer preview with 15,496,576 current-week tokens.
  Production configuration and data were not mutated.
- Release gates below record the final publication and live activation separately
  from these local candidate checks.
- The first candidate passed Backend CI `35981025805`; its image publication was
  intentionally cancelled before deployment to include the tool privacy boundary.
  Provider-free probes against the host's pinned Linux Codex 0.153.4 proved
  session, symlink, SQLite/history/log and audit denial while allowing managed
  skill reads, project writes and temporary files. Artifact and read-only project
  writes remained blocked. These used synthetic files and no model inference.


## Live activation evidence (2026-09-24)

- Product revision `d5472c33bcd1ac813325b0f80e3eb65dfe5fc591`: Backend CI
  `35985490048` passed on attempt 2. Attempt 1 had one existing injected-process
  recovery-test timeout; 10 isolated and three complete gateway-file repetitions
  passed before the unchanged failed job was rerun. Assertions were not relaxed.
- GHCR publication `35986229461` and Deploy Arnall `35986507674` passed.
  The deployed product digest is
  `sha256:ffc38b579fcd21f5733d8298042ab0ea1403bb2932065d9cdd45f8f936d5934b`;
  the egress digest is
  `sha256:1088a36088022443a7a54f25b941cb3fcbe6dfe999b6c247a43b4786e6aafdff`.
  Host release state, container OCI labels and public live endpoint agreed.
- Quota configuration was promoted transactionally on the same images, with
  active configuration SHA-256
  `eebd1034b01521fd4debe0d65aa52610019199bbbf064e9d816c96c7d2682d1e`.
  The host release-manager copy needed the reviewed strict `usageLimits` schema
  update; its original was retained privately before the update.
- Maintenance drained to zero activities. App and detached automation workers
  stopped for the packaged offline `--start-now` initializer. The actual capture
  was `2026-09-24T10:23:14.266Z`: 279 session files, 276 retained thread cursors,
  empty daily totals, no block reason, and all 7,500,000 tokens available.
  The private activation receipt is
  `/etc/aibrain/company-qa/weekly-budget-activation.json`. Never reseed it.
- After restart, both app and automation containers were healthy. Authenticated
  Arnau browser acceptance showed only `Saldo semanal disponible: 100%` in the
  chat and Settings > Uso, with renewal `28 sept 2026, 0:00 (hora de Madrid)`.
  The pre-existing draft remained unchanged. A request without a session to
  `/api/usage/budget` returned 401. Direct browser JSON-navigation capture was
  unavailable; API field privacy is covered by automated endpoint tests, while
  the live authenticated claim is limited to the rendered product surfaces.
- No model inference was requested for acceptance. Linux filesystem-policy and
  pinned App Server profile-switching proofs used synthetic files/provider-free
  operations; actual post-activation token deduction remains observable on the
  first user-requested model turn, not claimed as exercised by this rollout.
- Live host readback found canonical installation configuration is root-owned
  `0440`, so the host generation guard now uses a bounded operator-config reader
  instead of the `0600` credential reader. It accepts read permissions but rejects
  non-root ownership, symlinks, multiple links and group/world writes. The quota
  check still runs before credential access and model dispatch. The installed
  script hash is `3e02d69c5d0545e4ea114fe42af8c06253cf01aba74a65c58fdba9b91fce7963`;
  live readback returned `GENERATION_WEEKLY_TOKEN_BUDGET_UNSUPPORTED` before any
  provider call. Thirteen focused host-reader/guard tests passed.
- A fresh composite local backup was verified before rollout (snapshot
  `20260924T091525Z-4a001430-99ec-408d-b9c5-550762969b50`). Off-host replication
  remains unconfigured: the existing destination is a template `example.invalid`.
  No replacement destination or backup policy was invented during this change.


### Final host-guard release and retained allowance

The follow-up revision `f38fdff5c7b97aa78b3e322c7ae17460e66bf077` passed Backend CI
`35987361428`, GHCR publication `35987865291` and Deploy Arnall `35988193322`.
Its final product digest is
`sha256:d933e5d6be3fc22470c23e2e1ee11e78f91d739eff41c50e921b3f0a0be24052`;
its final egress digest is
`sha256:a61c31847f02c16b66c74f4024c8f7d2567b2112e33408dc5dee3bfcdb30427a`.

At `2026-09-24T10:38:31Z`, host release state, product/automation OCI labels and
public live endpoint agreed on that revision; both containers were healthy and
public readiness passed every required component. The active configuration hash
was unchanged. The ledger still had its original `2026-09-24T10:23:14.266Z`
initialization, 276 cursors, empty daily totals and no block reason. No second
seed was performed. The host guard's exact installed hash and pre-inference
quota denial were verified again. Employee UI/accounting code is unchanged from
the authenticated rendered acceptance on `d5472c3`; this follow-up changes only
the host operator-config reader, its tests and release documentation.
