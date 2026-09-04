# Closure continuation — local acceptance still partial

Starting candidate 80941ed81e2e7ab167d3ef3df539914c7388c05a; origin/main
048a7d4cef7752fe716f66e84e5c52f7ec663022 freshly fetched, already an ancestor.
A and F confirmed completed before this sole executor took the F checkout.
No production source changed in this continuation. Prior QA/build evidence
remains scoped to its original SHA, not silently relabelled.

## New evidence

- `scripts/qa-joined-successor.ts` passes against the existing compiled candidate:
  intercepted takeover -> real HTTP200 held -> UI closed -> successor takeover
  HTTP200 -> old response delivered -> exactly one old scoped release -> successor
  heartbeat HTTP200 -> explicit successor release -> ready. Fresh synthetic root
  `/var/folders/59/6_7xn8_14hg7vs8dqf1rcs040000gn/T/aibrain-joined-qa-VvgwFO`,
  `successor-checkpoints.json`. No inference or external navigation. The interceptor
  is installed before opening the frame; this avoids missing pointer-triggered
  takeover. The historical auxiliary latch failure itself is not diagnosed as a
  product bug. New script typecheck and ESLint passed.
- Real QPDF 12.4.1 installed with Homebrew core; dependencies ca-certificates
  2026-08-13 and OpenSSL 3.6.3. Initial certificate-link conflict resolved by the
  normal dependency/install commands, without unlinking unrelated tools or trust
  changes. `qpdf --version` succeeds.
- Joined production upload still rejects admission after QPDF installation.
  Fresh available bytes 10,605,195,264 versus required 13,329,101,620 on the Mac
  data volume (deficit 2,723,906,356). The availability fluctuates with shared
  activity. No guard or sanitizer was bypassed. Documents/UI/workbook remain open.
- Existing `codex login status` reports ChatGPT. A single real ephemeral CLI
  inference, codex0.152.1, gpt-5.6-sol/medium, read-only, prompt requesting HOLA
  with no tools: thread started1060ms, turn started1083ms, HOLA completed5088ms,
  turn completed5121ms, exit0 at5568ms. CLI JSON emits completed text, not a first
  token timestamp. An earlier item of type error was emitted; its detail was not
  retained by the minimal timing filter. This is only a successful CLI preflight,
  not AiBrain authenticated/three-chat latency acceptance. No credentials were
  read/copied/exported. AiBrain still needs login in its isolated per-user home;
  the existing desktop home cannot replace that isolation boundary.

## Scoped cleanup

Deleted only the inactive duplicate QA development build
`/Users/davidliria/Documents/AiBrain-melso-qa-ui-20260904/.next/dev` (~172MiB)
and this round's npm download cache `/tmp/aibrain-f-npm-cache-20260904/_cacache`
(parent measured~280MiB). No open handles, QA checkout clean, ownership checked.
Regenerable, permanently removed, not recoverable originals. Before/after `df`
available KiB10202120 ->11549480; this ~1.38GB observed gain includes concurrent
volume changes and is NOT attributed entirely to the ~452MiB removed. Kept F's
build/dependencies, logs, sessions, all sources/history and all worktrees.
Other round dependencies are symlinks; deleting them would not free their targets.
No external volume or Docker CLI is available. No production/Hetzner cleanup.

## Cloud boundary

One projectless ChatGPT Work cloud task created: conversation
6a9a7139-3698-83eb-bcf0-12c9db62f9dd, titled `Transferencia privada SHA exacto`.
It reports access to private origin/main but `not our ref` for the unpublished
candidate. No cloud tests or patch yet. Requested Sol/medium in the prompt only;
the cloud create API did not expose a model override. A private incremental Git
bundle is the next supported transfer option; no branch publication authorized.

No push, deploy, goals, reset credits, automation or customer effects. CLI
preflight does not accept application auth, Linux, connectors, automation or
production. Quota remained47% used at the continuation check.
