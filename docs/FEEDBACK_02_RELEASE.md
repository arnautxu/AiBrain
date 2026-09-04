# Feedback round 02 — release safety

Initial integration base: `8c5bc4cd95b15b1fd066a0ae4647d7a7b2bb6d4f`, Arnau's
generated PNG artifact delivery. Preserve this and every newer remote main
commit through normal merges; never force-push or restore an older directory.

The GitHub workflow already serializes deploys and checks current main. The
restricted host gateway now checks current main under its OS deploy lock both
before and after downloading the immutable images, before service mutation.
GitHub/API failure or a superseding main push aborts promotion without rollback
or changing the active installation. The ephemeral workflow token is read from
stdin and used for GitHub contents read as well as GHCR pull; it is not logged
or persisted as a GitHub credential. Existing GitHub workflow permissions
already include contents:read. No new credentials or purchases are required.

The host gateway must be installed from this reviewed source before promoting
this release; an image alone cannot update the host-only entrypoint. Verify its
hash and shell syntax, retain the prior controlled script, and install while
the same deploy lock is free. Do not interrupt an in-flight deployment.

The host lock serializes service promotions, not arbitrary GitHub pushes. A
push after the final API read can still exist while the current transaction
finishes, but no newer serialized deployment can be overwritten by it. Always
check main and live release again before acceptance; reconcile any newer main
instead of rolling back another author's release.

Detailed feedback cases, source comparison and live evidence are recorded in
the private round-feedback-02 CAPABILITIES.md and worker reports. Code, local
tests, CI, image publication, deployment and authenticated acceptance remain
separate gates. Missing OAuth consent or a second real identity is not PASS.

## Cancellation regression reproduced on 907dacd

A warm follow-up turn omitted its per-turn runtime thread token, so an active
remote turn entered the pending cancellation path. That path persisted a
confirmed stop before remote acknowledgment, while the client unconditionally
aborted its stream (even on rejection). Reload exposed the actual terminal
error. Warm turns now persist the same user-bound identity without an extra
thread/resume RPC. Pending requests record only request acceptance; the runner
owns terminal confirmation. Filesystem UI remains attached through confirmation
or rejection instead of manufacturing a successful stop. Candidate live stop
and refresh acceptance is still required; an uncertain interrupt is never
rewritten into success.
