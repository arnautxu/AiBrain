# MODTIME stable fleet enrollment

MODTIME is the isolated `aibrain-modtime` Compose installation at
`46.62.215.84`, using the common application images. It must never inherit
Arnall credentials, configuration, data, browser sessions or company files.

The `Deploy accepted release to MODTIME` workflow consumes the
`aibrain-canary-accepted` repository event. The acceptance publisher supplies
`client_payload.revision` (full SHA) and `client_payload.acceptance_run_id`
(successful same-repository Actions run containing the sanitized artifact
`aibrain-live-acceptance-<SHA>`). The artifact contains `manifest.json` and
`evidence/`, in the common acceptance verifier's existing format. No new
acceptance schema or abbreviated health-only approval is introduced.

The workflow revalidates common live acceptance, all evidence hashes, exact
candidate checkout fingerprints, distinct successful CI/Publish/Arnall runs,
the published digest pair, and forward ancestry from the running MODTIME
revision. Failed, incomplete, superseded-by-an-already-installed, or foreign
packets cannot promote. An accepted event is the automatic stable release
trigger; a mere push or green deploy is not.

Secrets `MODTIME_DEPLOY_SSH_KEY` and `MODTIME_DEPLOY_KNOWN_HOSTS`, and variable
`MODTIME_DEPLOY_HOST`, belong only to this target. The SSH public key is
restricted to `/opt/aibrain-modtime/ghcr-ops/deploy-modtime-main.sh`, with no
PTY, forwarding, agent forwarding or unrestricted command execution. Its only
commands are `status` and an exact immutable `deploy-ghcr` invocation. Registry
authentication uses the temporary Actions token on stdin and is deleted before
promotion. Never register a personal broad GitHub token on the customer host.

The gateway delegates promotion and automatic recovery to the unchanged common
`manage-release.mjs`. Install its reviewed bundle and effective Compose under
`/opt/aibrain-modtime/ghcr-ops`. The effective Compose must merge the common
Compose with `/etc/aibrain/modtime/compose.modtime.yaml` and preserve its branding
mount, independent runtime paths and current resource limits. Candidate
InstallationConfig is a byte-for-byte copy of MODTIME's active configuration.
No global Docker cleanup or implicit customer-data rollback is performed.

## Enrollment evidence and remaining activation gates

On 8 September 2026, GitHub accepted the dedicated SSH secret and target host
registration. This disproves the earlier assumption that enrollment required a
separate release-owner approval. The fresh implementation checkout is isolated
from the active Arnall release worktree.

At the initial enrollment preflight MODTIME ran `8b57f843f6548402ef2903f5b96e7239dd331070` from a verified
Docker save/load transport; its images lack RepoDigests and it has no V3 ledger.
The same revision has successful Backend CI34156445504, Publish34156813801 and
Arnall Deploy34156976420. Before enabling promotions, use a temporary package
credential to pull that release's original published digests, confirm identical
image IDs, preserve a verified MODTIME backup, and perform the common controlled
V3 bootstrap with exact current Compose/config/runtime readback. Do not invent a
ledger or relabel config image IDs as registry manifest digests.

Activation is incomplete until that bootstrap, a controlled no-op, rollback and
return, authenticated MODTIME acceptance and a valid current canary packet are
verified. A registered key, a healthy status response, this workflow file or a
pending PR does not establish working automatic updates. Never dispatch a fake
accepted event to make the workflow green.

The restricted gateway and key are installed on MODTIME. Its read-only status
probe passed and reports revision89b0ca97613945a52da870a04d523231e5548622
(without a release ledger), reflecting a separate shared-product deployment
during enrollment. An arbitrary `echo forbidden` SSH command was rejected.
No application restart or image/config migration was performed by enrollment.
The workflow remains a source candidate, and acceptance publishing plus V3
bootstrap are still prerequisites; no automatic-update completion is claimed.
