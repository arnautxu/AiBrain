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

The host gateway requires the reviewed promotion-fence change before promoting
this release; an image alone cannot update the host-only entrypoint. The active
host script predates unrelated cleanup changes in main, so only the fence and
its call argument were applied to that exact host source. No cleanup policy or
legacy release directories were changed. Installed under the existing free
deploy lock, with original SHA256 `795407353e0c2e20a7c803d3e78c57f1da265f2116da2aa7206bae9343b9f385`
retained in `.before-feedback02-cc17d42` copies of both controlled scripts.
New SHA256: `dfb5c250e3086185b5ce8ad693a94a50130325528cdac97ac8a97b6c6af34e3e`.
Shell syntax and readback hashes passed; live app remained 907dacd. Do not
interrupt an in-flight deployment or replace newer host changes.

Branding is also staged transactionally by the gateway: only the generic
AiBrain logo/favicon defaults are migrated to `/branding/arnall/logo.jpg`, and
only for companySlug=arnall. Any newer custom paths, all other configuration,
and the active release's configuration remain untouched until promotion.
Directly editing the active JSON would violate the release input drift check.
Pure contract tests verify original preservation, custom-path preservation and
foreign-company rejection. Installed host gateway after this scoped follow-up:
`e3effb3ec2b545f7bb8e63008df69cd6c845317d0ecca65dbd87553f2e3852dc`;
prior fenced copies retained under `.before-feedback02-branding`. Active app
and logo were still unchanged at installation readback. No wider cleanup
changes from main were installed.

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

## Original legacy PDF, not a regenerated substitute

The actual workspace `hello-world.pdf` is 435 bytes, SHA256
`33da4c464e46fb867012cbdd8803bd14913590897d074824a4754f4e05656d07`.
QPDF reports missing startxref and an incorrect stream length. Exact bytes are
retained in the regression fixture, with no source repair in production.
The distinct `documents/hello-world.pdf` is 586 bytes, SHA256
`92b6394f4cd824ea0f8c4fa38f5762766cd21fc8d0bf860bbc50d5be1e0d84f0`,
and passes QPDF checks. Both original chat URLs use project/files, not staged
document previews. Private PDF raw previews now use the existing content-bound
representation cache, normalizing a separate copy with QPDF and strictly
validating it. Downloads retain original bytes; permission and indexed hash
checks still precede conversion. A changed historical indexed artifact remains
a safe 409, not an excuse to bypass identity checks. Both real URLs and refresh
still need authenticated candidate acceptance.

The first normalization regression failed correctly: a plain QPDF rewrite
retained the absent trailer /Size. A separate page-only container now rebuilds
that structure, then passes strict QPDF validation and text/pixel extraction.
This is a viewing representation, not a replacement for original document
metadata/bookmarks/signatures; downloads remain untouched. Exact legacy test
passed (1.16s), and new PDF/old cache regression passed (1.17s). The other three
native formats and aggregate native matrix passed before this PDF-only follow-up.
Root visually inspected the rebuilt legacy page. Production acceptance remains
independent from those native tests.
