# Browser interaction transport

The authenticated browser panel uses bounded HTTP input requests and a changed-frame PNG stream. The default capture interval is 100 ms (at most 10 changed frames per second); it is not a full remote desktop or a 60 FPS browser. The 20-second stream lifetime stays below the short-lived viewer token lifetime. It is a renewal boundary, not a fixed delay before accepting input.

## Input and paint behavior

- Manual URL navigation and history controls acknowledge Chrome dispatch without holding the exclusive runtime lane until the document finishes loading. The frame reader can expose progressive content. Agent navigation still waits for readable document state.
- Consecutive key-down/key-up events share one authenticated `inputs` request. The entire batch is validated before dispatch; the maximum is 32 commands. Commands execute in order, controller ownership is rechecked in the runtime, and failed or uncertain mutations are never replayed. Confirmed prefix actions remain eligible for the existing minimal audit history.
- Unsent adjacent pointer moves keep the latest position. Unsent adjacent wheel events accumulate their deltas, including line/page unit conversion. Keys, click transitions and navigation are ordering barriers. Already dispatched events are never replaced.
- URL/history controls display a pending state immediately. This is feedback, not evidence of remote paint completion.
- Stream EOF renews the viewer token and lets the React effect open exactly one replacement stream. Responses prohibit cache/transformation and request identity encoding; the existing proxy-buffering opt-out remains.
- A newly committing Chrome target can temporarily lack a screenshot surface. That read retries briefly without destroying the target or replaying navigation. Screenshot and input operations retain the exclusive CDP lane; concurrent capture was rejected after real-Chromium races.

## State and authorization

An unexpired lease check still obtains the lock and reads current browser state, but no longer rewrites/fsyncs identical state. Expiry and other mutations remain durable. Worker provisioning is initialized once per store/user; every subsequent browser-root access still checks real directories, symlinks and canonical containment through the installation/user ancestors. Failed initialization can retry. Authentication, enabled-user checks, feature gates, token bindings, takeover, network policy and profile isolation are not cached away.

The gateway uses an existing runtime handle instead of running a full start/health probe before every input. Status/start and operation recovery continue to detect unhealthy runtimes. Input responses expose duration-only `Server-Timing` entries for gateway authorization and service dispatch. The latter includes state checks and auditing; it is not a worker CPU measurement.

## Verification and release acceptance

The focused tests cover batch boundaries, uncertain-prefix stopping, private-thread routing, lease expiry, symlink rejection, stream renewal, ordering and input backpressure. Opt-in real Chromium tests cover navigation, progressive paint while a slow response remains open, Unicode paste/keys, held-pointer text selection, release rejection, user-private profiles/downloads and pinned public egress.

Run real Chromium only under the shared release QA mutex on the constrained workstation. `AIBRAIN_REAL_CHROME_TEST=1 npm run test:browser:real` enables the real suite. `AIBRAIN_BROWSER_STORE_EVIDENCE=/tmp/browser-store-evidence.json` enables the small local filesystem lease-check measurement in `browser.test.ts`. These measurements do not include the production gateway or UI paint.

After integration/deployment, use a dedicated authenticated Arnall QA tab and measure event-to-useful-image paint inside the page, separately from HTTP acknowledgment and automation-tool duration. Collect enough cold/warm repetitions for median and p95. Exercise clicks, wheel, drag, Unicode/paste in a form, URL Enter, history, reload, resize, mobile, more than one token renewal, explicit release, reattachment and two-user separation. Check chat responsiveness while the viewer is active. Verify server-side release/stream cleanup. Do not claim live acceptance from local tests, immediate loading indicators, or unchanged screenshots.

## Melso comparison boundary

The inspected Melso checkout provisions a persistent Ubuntu/XFCE desktop with TigerVNC and noVNC on loopback. Its image README says it does not tunnel/expose a public desktop. The paired daemon's WebSocket RPC and `tasks.claim` handler provide task coordination; they are not evidence of a browser-frame/input tunnel. The short-lived attachment capability signs individual file downloads. No public remote-browser viewer transport was located in that checkout, so there is no source-backed Melso latency/parity claim. This change adds no desktop service, exposed port or paid dependency and copies no Melso source.
