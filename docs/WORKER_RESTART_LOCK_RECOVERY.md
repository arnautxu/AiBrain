# Worker restart and observation retention

On 12 October 2026 the Arnall automation process exhausted its Node heap during
the noon invoice run. Its request ledger had grown to approximately 169 MiB.
Repeated `turn-completion-reconcile:` reads were not included in the existing
4 MiB retention budget for completed read-only observations. A restart then
reused PID 7 in the same container hostname. The durable journal lock predates
that new process, but checking only PID liveness prevented its recovery. Both
noon and 17:00 invoice occurrences subsequently failed at gateway startup.

The candidate applies the existing observation budget to those completed reads.
It preserves every uncertain request and creation/effect receipt. The lock owner
format stays compatible with existing readers: an owner-token-bound sidecar
records Linux process start ticks and PID namespace. Unavailable or malformed
identity remains fail-closed for a live PID. For a legacy lock without a sidecar,
only the acquiring process's own reused PID can be distinguished by its known
start time, with a two-second margin. Other live legacy owners remain protected.

Operational recovery preserves the exact abandoned lock and backs up journals
before native compaction. It never expires admitted model tickets by age: the
same durable invoice turn must reconcile its provider receipt before completion
or interruption is asserted. Invoice results, originals and business approval
remain distinct. Local tests, Linux checks, required CI, publication, deployment
and live UI/Excel acceptance are separate gates.
