# Dictation permission correction, 2026-09-07

Live Arnall returned two independent Permissions-Policy headers with
`microphone=()`: Next.js and its dedicated nginx virtual host. The policy itself
prevented getUserMedia from requesting permission, so the user saw a denial
without a browser permission prompt. The shared Next.js and nginx template now
use `microphone=(self)`. Other capabilities remain denied. This permits a browser
prompt; it does not grant microphone permission or begin recording.

Operators must snapshot and update only the Arnall virtual-host header, run
`nginx -t`, reload nginx and verify the public response. MODTIME must be checked
independently; its application header updates through its own image deployment.
Do not change global browser or OS microphone permissions. Reverting the header
reinstates the original policy block.

Dictation checks page policy before asking for audio, distinguishes waiting for
native permission from recognition, and presents a visible recovery panel on
failure. Site/OS instructions appear for permission failures; unsupported
recognition and service errors retain their separate explanation. Retrying is
another explicit user gesture. The microphone preflight stream is stopped
immediately, speech stays editable, and sending remains a separate action.

Acceptance: native-device and recognition mocks cover consent, denial, retry,
no-support, policy denial, HTTPS and transcript cancellation. Verify the public
headers and real browser policy after deployment. Real voice capture requires
the user's own gesture and permission; mock success is not a live voice test.
