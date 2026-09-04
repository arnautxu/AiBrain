# Arnall chat archive inventory (planning only)

This candidate does not read or mutate production. The integrator must export a
read-only complete thread snapshot from Arnall, generate a reviewable plan, and
apply changes only after approval on the deployed, authenticated release.

## Generate the inventory

```bash
npx tsx scripts/plan-chat-archive.ts \
  --input /absolute/private/arnall-thread-export.json \
  --output /absolute/private/arnall-archive-plan.json \
  --recent-days 30 \
  --target-ratio 0.9
```

The command only creates a new mode-0600 plan and refuses to overwrite an
existing file. It preserves every pinned, recent (30 days by default), or
substantive conversation. It selects only QA/test/demo/duplicate or very short,
low-content candidates and stops below 90% rather than padding the plan with
unsafe candidates.

## Safe integration procedure

1. Export under an authenticated administrator session using a read-only path.
2. Generate the plan and review every `archive` item with its reason. Search the
   preserve set for active customer work, commitments, decisions and named work.
3. Record the deployed SHA, export hash, plan hash, reviewer and counts.
4. Apply archive mutations in small idempotent batches through the existing
   authenticated thread API. Never delete; stop on the first unexpected status.
5. Re-read every changed ID and verify `archived`, while pinned, recent and
   substantive preserve IDs remain active.
6. Keep the export and plan private. The export can contain message content;
   the plan contains conversation titles, IDs and preservation reasons.

Archiving roughly 90% is a target, not permission to weaken preservation rules.
