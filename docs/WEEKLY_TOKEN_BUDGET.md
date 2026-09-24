# Installation weekly token budget

Candidate implementation, 2026-09-24. Not yet published, enabled or accepted live.

Arnall's selected policy is **7,500,000 total tokens per week**, shared by all
employees. Cached input is included exactly once. Reasoning output is already
part of output and is not added again. This is an internal token budget, not a
percentage of a ChatGPT subscription or a billing estimate.

The week starts Monday 00:00 in `Europe/Madrid` and ends at the next Monday,
including daylight-saving transitions. In-app notices occur at 25% (1,875,000),
50% (3,750,000), and 75% (5,625,000); exhaustion remains visible with the reset
time. Notices are scoped to the signed-in user, installation and week. The
counter is shared, not a separate allowance for each employee.

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
If a tracked turn ends without any usage evidence, new inference pauses for a
two-second grace period. If usage still does not arrive, the ledger requires
operator reconciliation. This includes cancellation before a response: absent
usage is not affirmative evidence of zero consumption.
The accounting source is `thread/tokenUsage/updated` cumulative totals, not the
legacy chat journal's last response count. Admission covers chat, scheduled
tasks, horarIA and steering in the shared runtime client. Reading conversations,
stopping tasks and recovering an already-started turn stay available.

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

Do not initialize an existing installation to zero. The read-only analysis on
2026-09-24 found roughly **15.50 million** logged tokens since Monday in Arnall;
including that week at activation will immediately exhaust 7.5 million. This is
a **measured lower bound**: legacy ephemeral horarIA and host knowledge calls may
not be present in session logs. The packaged initializer therefore permits an
import only when measured history already exhausts the selected week; it refuses
to grant a remaining allowance from incomplete legacy history. Lower totals or a
fresh installation require complete reconciliation/an explicitly verified empty
baseline before using the store's initialization interface. Refresh the history
during rollout; the snapshot is not a reusable production seed.

1. Complete the normal Backend CI, GHCR and deployment gates for the candidate.
   Stop/drain the app, automation, horarIA and knowledge model workers before the
   initial seed. No old, unmetered runtime may continue during activation.
2. Prepare the private installation config with the chosen `usageLimits`. Run
   the candidate's packaged initializer with the same config/data/users mounts,
   as the application UID. First inspect its **read-only** summary:

   ```sh
   node /usr/local/share/aibrain/initialize-weekly-token-budget.mjs --offline
   ```

3. After reviewing the summary, initialize once:

   ```sh
   node /usr/local/share/aibrain/initialize-weekly-token-budget.mjs --offline --apply
   ```

   Local source equivalent: `npm run usage:initialize-budget -- --offline [--apply]`.
   The initializer reads only this installation's private workers' session and
   archived-session metadata/token events. It keeps the counter before Monday,
   deduplicates active/archive copies, excludes inherited fork history and handles
   explicit counter resets. It rejects symlinks, ambiguous current-week history,
   malformed records, future events and files modified during inspection.
   It prints counts only. It refuses to replace an existing budget ledger.

4. Start the candidate workers. Verify authenticated `/api/usage/budget` returns
   the selected limit, Madrid week and imported amount without any provider call.
   Verify a foreign/missing session cannot read it. On this already-exhausted
   week, a new prompt must be rejected before `turn/start`; a history read must
   still succeed. Use fixtures, not paid inference, for the three threshold tests.
5. Record host-script checksum, configuration/ledger readback, exact release SHA,
   and authenticated browser acceptance independently of CI/publish/deploy.

A weekly reset changes the displayed period; it must not delete thread cursors
or replay evidence. Never delete/reseed the ledger as a routine reset or recovery.
Investigate an unavailable/reconciliation state with all model workers stopped.
Disabling the installation policy removes the budget and requires an explicit
operator decision; rolling back to code without quota enforcement also removes
its protection and must not be described as retaining the limit.

## Candidate validation (2026-09-24)

- Typecheck, repository lint, production Webpack build, both server executable
  bundles, generated Codex contracts and infrastructure validation passed locally.
- 144 focused usage/runtime/UI/HTTP/configuration tests and 24 host generation
  tests passed. The wider suite passed 1,643 tests with 23 skipped; its new-route
  catalog failure was fixed and retested, and an unrelated skill-copy timeout
  passed all five tests when run in isolation.
- Local rendering with actual BrainApp/CSS at 1440, 390 and 320 pixels kept the
  composer visible without overflow; the budget strip passed axe in both themes.
  These were synthetic sessions, not authenticated live acceptance.
- A read-only capture of token metadata from the live host's 279 session files
  passed the packaged initializer preview with 15,496,576 current-week tokens.
  Production configuration and data were not mutated.
- Backend CI, GHCR publication, deployment and authenticated live acceptance
  remain separate, pending gates. No remote release has been made for this change.
