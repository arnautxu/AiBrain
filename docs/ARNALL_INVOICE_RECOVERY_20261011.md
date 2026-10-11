# Arnall invoice recovery, 11 October 2026

Production at `3e3e9c6` has two admitted invoice turns with uncertain remote
completion. They occupy the installation's two model queue slots. Reconciliation
of those exact turns must retain their client IDs, original files and durable
receipts; do not expire admitted tickets merely because they are old.

The 12:00 task exhausted its queue wait. The 17:00 task's recovery repeatedly
timed out on optional inherited `skills/list` before reaching the existing remote
turn. The owner mailbox remains owner scoped. David's administrator UI can view
the tasks/results, but the result conversation is read only for that account.

This candidate prevents optional inherited skill inventory from blocking
reconciliation of a pending model turn. For a fresh turn, only a `skills/list`
timeout permits proceeding without inherited skills. An explicitly selected
skill still fails closed if inventory cannot be validated; unrelated errors
still propagate. Current catalog and connector authorization remain required.

Document storage backpressure is reported separately from mailbox failure,
with a bounded retry hint and no private filesystem paths. The storage admission
threshold is unchanged. Disk cleanup alone does not prove invoice acceptance.

Release gates remain Backend CI, immutable GHCR publication, transactional
deployment, backup/rollback availability and authenticated real UI acceptance.
Close the incident only after the two original affected workflows reach their
actual result, preserve invoice deduplication and provide a readable journal
Excel. Do not replace that proof with a successful health endpoint or QA turn.
