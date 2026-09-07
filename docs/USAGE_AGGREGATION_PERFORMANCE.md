# Usage aggregation: bounded local optimization

Integration baseline: `14b730ebdb56bea93b3c3e2c2c98aebeae2f05f5`, 7 September 2026.
Reviewed source change: `b9f03481c61989f9aa3108db054167c6a19d898c`.
The current baseline aggregation source is byte-identical to the source change parent.

`aggregateTurnUsage` feeds personal/company usage and workspace administration.
It previously made separate passes for statuses, dates, tokens and averages,
allocating filtered/mapped arrays plus copies for percentile sorting. It now
collects counters, sums and the two percentile buffers in one pass. Sorting
consumes those private buffers; input records and token objects remain intact.
No storage, authorization, per-user selection or shared cache behavior changes.

Reproduce from the repository root:

```sh
node scripts/benchmark-usage-aggregation.mjs 14b730ebdb56bea93b3c3e2c2c98aebeae2f05f5
node_modules/.bin/vitest run src/usage/file-usage-store.test.ts src/usage/server-service.test.ts --maxWorkers=1
```

The benchmark extracts and transpiles the actual pure functions from each
revision, verifies deep equality on deterministic synthetic mixed-status data,
warms both functions and alternates execution order across 15 samples. Small
inputs use batches to reduce timer noise. Median milliseconds per aggregation
on the local Mac:

| Records | Baseline | Candidate | Time reduction |
| ---: | ---: | ---: | ---: |
| 100 | 0.02299 | 0.01668 | 27.4% |
| 10,000 | 3.41658 | 2.81363 | 17.6% |
| 100,000 | 38.44271 | 33.46392 | 13.0% |

The benchmark also checks 50 exact-equivalence cases against the actual baseline
function: empty/singleton inputs, percentile boundaries (19/20/21 and 99/100/101),
10,000 and 100,000 records, user/status/date/null-measurement subsets, decimal
and zero durations, all six token fields and frozen records/token objects.
Regression tests cover nearest-rank p95 and arithmetic on 100,000 records,
empty/missing/zero measurements, statuses, dates, rounding, input preservation,
and aggregation after persisted per-user selection, including an absent user.

This measures aggregation CPU only, not disk reads, endpoint latency or live
Arnall response time. Exact sorting still costs O(n log n); buffers still cost
O(n). Measurements used Node 24.4.1 on the local Mac and alternating execution
order across 15 samples, with 10 warmup batches. No UI, contracts, permissions,
storage or release behavior is changed. CI, publication, deployment and live
acceptance must be checked separately for the resulting integration SHA.

Local integration validation: 58 focal tests passed, plus TypeScript, full lint,
generated Codex contracts, static infrastructure checks and the production build.
The full suite passed 1,396 tests with 20 skipped; four backup-orchestrator tests
failed solely because its unchanged URL handling cannot resolve a checkout path
containing spaces. After moving the isolated checkout to a path without spaces,
all four passed (1,400 passing tests across the suite and focused rerun).
No backup code was edited. Docker Compose runtime validation was unavailable
locally because Docker CLI is absent; CI remains the immutable container gate.
