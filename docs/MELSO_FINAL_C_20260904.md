# Final C — joined browser recovery acceptance

2026-09-04. Product candidate: `3a95d9d110591a892fbacc870a174cacaf0611bc`.
Worktree: `/Users/davidliria/Documents/AiBrain-melso-final-c-20260904`, branch
`codex/arnall-melso-final-c-20260904`. Initial fetch observed
`origin/main=048a7d4cef7752fe716f66e84e5c52f7ec663022`; pre-commit fetch
confirmed the same revision. No merge was performed.

## Scope and result

This pass supplies the reproducible opt-in
`scripts/qa-joined-browser-recovery.ts`. No product behavior change was needed.
It reuses the matching candidate production build from worker F without another
build or dependency installation. The server harness retains real durable local
session validation, owner/origin checks, signed capability tokens, production
input routes, registry and real Chromium CDP dispatch. Synthetic session
issuance is not remote IdP login. Network egress and model inference remain
disabled by the existing fixture. No customer/provider credentials are used.

The complete independent `qa-ui/REPORT-R2.md` was read before implementation.
Its seven successful joined checks remain separate evidence; this pass does not
claim to repeat those checks or full release acceptance.

## Three joined recovery scenarios

1. **Response lost after executed input.** The driver focuses the rendered
   image and observes exactly one mousePressed/mouseReleased pair. It forwards
   the real x keyDown request with `route.fetch({maxRetries:0})`, checks the
   application's HTTP 200 / `ok:true`, and waits for the fixture's private-CDP
   DOM readback to equal `x`. Only then does it abort response delivery to the
   client. The already-enqueued y/z events never reach the route; even x keyUp
   is cancelled, leaving exactly one x request. It closes a reader over actual
   frame bytes, observes a new viewer stream, and verifies no replay. A new
   deliberate q produces `xq`; closing the panel returns the real state to ready.
2. **Close during pending takeover, no successor.** The real takeover executes
   while its response is withheld. Closing the panel precedes delivery. The
   old attachment sends exactly one scoped compensating release; the registry
   returns to ready/agent and rotates the browser-session UUID. No pending
   click or OLD text request reaches either target.
3. **Delayed takeover followed by thread switch.** A second synthetic thread
   is created through the real authenticated workbench route. The sidebar
   switches to it before the old real takeover response is delivered. Scoped
   compensation returns ready/agent with session rotation and zero old inputs.
   A deliberate n then reaches only the new thread's real target. The original
   DOM stays `xq`; closing leaves no human-control orphan.

All interception latches have a 5-second deadline, immediate checkpoint output
and a finally release. Route-forwarding failures fail the run; they are not
replaced with success bodies. Browser/context cleanup runs on failure as well.
The only faults injected are response withholding/abort and client EOF over
real network bytes. Real application outcomes are never mocked.

An initial harness attempt did not render its first frame. Replacing the
TypeScript-transformed injected function with a literal browser script fixed
that setup issue; no timeout or product assertion was relaxed. The completed
implementation passed, then passed again from a fresh server root after adding
explicit agent-controller/session-rotation assertions. Each run has one sample
per scenario; these are correctness checks, not latency measurements.

Final evidence: `/tmp/aibrain-final-c-recovery-fresh.log` and the private root's
`recovery-results.json`, with nine ordered checkpoints and `passed:true`.
Fresh root:
`/var/folders/59/6_7xn8_14hg7vs8dqf1rcs040000gn/T/aibrain-joined-qa-c7C44Y`.
Do not publish `storage-*.json`, private certificates or signing/session secrets.

TypeScript no-emit checking and ESLint for the changed script/test pass.
`git diff --check` passes. Type/lint jobs used the shared atomic test lock;
dependencies are the read-only F symlink and TypeScript cache is private in
`/tmp`. No broad suite or benchmark rerun was needed for these harness/docs
changes. The owned server exited zero; no listeners remain on3196/3197,
and F's tracked checkout remains clean.

## Reproduce without inventing another driver

Use a checkout with a production build matching the product candidate. Start
the existing server as documented in `MELSO_R2_F_20260904.md`:

```sh
AIBRAIN_JOINED_QA=1 \
AIBRAIN_CHROME_BIN=/absolute/pinned/chrome-headless-shell \
AIBRAIN_CHROME_EXPECTED_VERSION=151.0.7922.34 \
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
node --import ./scripts/register-server-only-stub.mjs --import tsx scripts/qa-joined-browser.ts
```

From the checkout containing this driver and its dependencies, pass the fresh
root printed by that server:

```sh
AIBRAIN_JOINED_QA=1 node --import tsx scripts/qa-joined-browser-recovery.ts /absolute/aibrain-joined-qa-ROOT
```

The driver expects an unused fixture DOM and creates one extra synthetic thread.
Use a fresh server/root for each reproduction, rather than resetting assertions
or mutating previous evidence. A failed checkpoint exits nonzero and records
its error. Stop the exact owned server with SIGTERM after the driver; this
closes its registry, HTTPS3196 and deny proxy3197. No broad process cleanup.

## Metric correction — no new benchmark

The timer in `chrome-runtime.real.test.ts` stops immediately after
`agentNavigate`; screenshot validation follows outside the timed interval.
`MELSO_R2_C_20260904.md` and the source comment now say **navigation-only**.
No recorded sample was changed or benchmark repeated. Worker F's shared
`MELSO_R2_F_20260904.md` table still requires the same label correction from
“navigation+capture” to “navigation-only; capture validated separately”.

Original C measurements, Chrome151/macOS, n=3 per page and per revision:

| Page | Before median; range (ms) | After median; range (ms) |
| --- | --- | --- |
| Linked | 1296; 800–1636 | 62; 56–82 |
| Form | 4318; 4173–4632 | 53; 51–155 |
| Blank | 4192; 4185–4223 | 45; 45–46 |

Independent R2 QA used different delayed destinations, not a baseline comparison:

| Destination with 450 ms delay | n | Navigation-only median; range (ms) |
| --- | ---: | --- |
| Response headers | 2 | 512.6; 511.4–513.8 |
| Redirect to delayed headers | 2 | 513.4; 513.408–513.411 |
| Chunked body | 2 | 480.6; 480.1–481.1 |

QA observed correct final title/URL/marker and nonempty later captures in all
six cases. No provider-speed, FPS, percentile or production-latency claim.

## Diagnostics and remaining gates

The source already maps typed `BrowserGatewayTokenError` to 401/403/409 and
limits retryability. The joined custom server injects a source-module token
service into a separately bundled app; distinct constructor identity is a
plausible reason its `instanceof` classification falls back to 503. This is an
inference, not a demonstrated production defect. Stale attachment heartbeat
also throws an ordinary Error in the registry. No cosmetic classifier change
was made; safe error categorization can be examined under the default production
composition separately. All reported negative requests failed closed.

Document acceptance remains **BLOCKED** by the independent current evidence:
10,662,047,744 bytes available versus 13,329,101,620 required, and missing real
production QPDF. No guard/sanitizer change, upload, large artifact, installation
or data cleanup was attempted. Earlier availability-conditioned service tests
do not close the real Library/preview/download gate.

Still separate: Linux container execution, real IdP/provider/model account
acceptance, cross-user concurrent frames, process restart, document acceptance,
CI/publication/deployment. No push, deploy, goal, automation or extra task.
