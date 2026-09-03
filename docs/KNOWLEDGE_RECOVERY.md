# Isolated knowledge recovery

`knowledge-backup.py restore` verifies a snapshot and writes it to a new private
root with `restore-requires-reconciliation.json`. All employee retrieval remains
blocked by that marker. The restored bindings are historical evidence, not current
authority. Restoring files alone does not make a recovered installation ready.

`knowledge-recovery.py` supplies the remaining operator workflow. It rejects a
restore destination overlapping the current live knowledge root, checks the gate
and installation identity, and takes the restored operator catalogue lock. It
never changes the live root, broker, application mounts, credentials or Windows
files. Its Windows checks use the existing fixed read-only source verifier and
shared connection lock.

## Reconcile in bounded batches

Supply the current private host manifest and current binding file, outside the
restored snapshot. The separately provisioned current scope markers must exist.
For example, on Hetzner:

```sh
python3 /usr/local/lib/aibrain/knowledge/knowledge-recovery.py batch \
  --manifest /etc/aibrain/company-qa/rdp/server-files.json \
  --bindings /etc/aibrain/company-qa/rdp/knowledge-bindings.json \
  --destination /var/lib/aibrain/RESTORE-DRILL/restored \
  --max-files 2 --seconds 120
```

Run under the existing knowledge service resource/sandbox protections. The CLI
requires the host operator. Tests run as an unprivileged user with fictional
configuration; their fixture loader does not replace the production owner guard.

The first batch invalidates every indexed operator document's old source lease.
The progress marker is written only after that transaction commits. An interrupted
initialization repeats invalidation safely. Binding, access-policy or connection
configuration changes start a fresh verification generation; credentials are
represented only by private hashes and never printed or restored.

Only indexed documents assigned a non-null audience by current rules need fresh
source checks to open the reader gate. The stored original's hash is checked first.
A matching source refreshes its lease. A changed/oversized/deleted/denied source
invalidates its old indexed content and derived claims under existing lifecycle
rules. Changed documents remain queued for later extraction; recovery never
pretends that it has extracted their new contents. Unbound operator documents
retain no usable restored lease and cannot be published by a later scope expansion
without a fresh check.

An unavailable source remains unresolved, not deleted. Batches order unchecked
sources before recently attempted failures, respect file/time admission limits,
and yield on `SOURCE_BUSY` without removing or bypassing locks. The current file
finishes under the source verifier's own timeout. Policy denial or corrupt local
objects stop the operation with the gate intact. There is no automatic gate removal.

## Verify publication and open only the restored reader gate

When `pendingSourceChecks` is zero, run the same command with `finalize` instead
of `batch`. Finalization:

1. Rechecks current external scope/configuration state and source-lease freshness.
2. Reconciles restored partitions against current bindings and verified operator
   content. Withdrawn/changed sources and removed audience bindings cannot survive
   as readable old partition copies.
3. Publishes up to 1,000 documents. `RECOVERY_PUBLICATION_PENDING` keeps the gate
   closed; repeat finalization to finish another publication batch.
4. Rechecks policy and freshness after publication, durably writes
   `recovery-verified.json`, then removes and fsyncs the gate marker.

The receipt contains counts, backup identity, timestamps and a policy fingerprint;
it contains no document content. It proves reconciliation, not a live cutover.
A receipt written just before a crash may coexist with the gate: always inspect
both, and repeat finalization while the gate remains. A successful CLI response
reports `readerGateOpened: true` only after durable gate removal.

Validate authorized/denied reads against that isolated root. Switching the live
broker/app to it is a separate, explicit recovery operation with its own release,
continuity and authenticated acceptance gates. A successful isolated drill does
not prove off-host replication, full-corpus ingestion or application recovery.

## Verification

The recovery suite covers lease invalidation, interrupted/resumed traversal,
changed/deleted/revoked sources, bounded admission, policy changes, publication
limits, corruption and unsafe restore paths. Root-ownership rejection is checked
separately without substituting the production guard. Keep each installation's
real backup, source checks and gate readbacks in private operator records.
