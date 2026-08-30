# AiBrain execution status

The authoritative current snapshot is [OPERATING_TRUTH.md](OPERATING_TRUTH.md); the bounded next-work list is [PRIORITIZED_BACKLOG.md](PRIORITIZED_BACKLOG.md).

This file no longer tracks transient worktree handoffs. Git branches, worker completion and local commits are implementation inputs, not delivery states. For every release report these separately:

1. integrated local SHA and tests;
2. Backend CI run;
3. GHCR Publish run and digests;
4. Deploy run and host/runtime readback;
5. authenticated live acceptance and rollback.

Baseline integrated for the 2026-08-30 operating-truth refresh: `origin/main=af2c36388b518feb8fc2cc86eeff7d0302672491`, a descendant that preserves `faac15c`. The changes documented after that baseline remain local until explicitly pushed and therefore have no CI, publication, deployment or live-acceptance status.
