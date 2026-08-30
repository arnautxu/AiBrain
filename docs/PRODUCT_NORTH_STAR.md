# AiBrain product north star

Last versioned refresh: 2026-08-30. See [OPERATING_TRUTH.md](OPERATING_TRUTH.md) for the current evidence boundary.

AiBrain succeeds when a company can use one isolated installation as durable working memory and an authorized execution layer: real employees keep private and shared work, retrieve only permitted information, complete real turns without duplication, approve sensitive effects, and trace every accepted result to the exact product release.

## Mandatory product outcomes

1. **Isolation:** two real employees can work concurrently and denied cross-user or cross-tenant access performs no foreign durable-store read.
2. **Continuity:** a real turn streams to exactly one durable terminal state and survives refresh, reconnect, worker recovery and application restart.
3. **Useful company context:** a new installation starts with source-backed structure; unknowns stay explicit and a seed replay never replaces edited production content.
4. **Governed effects:** documents, browser actions, connectors and automations are authorized server-side and return controlling-system readback. Employee browser/computer use runs without interactive approval while retaining exact actor/target/version binding; sensitive connector effects keep their explicit approval boundary.
5. **Release truth:** Backend CI, GHCR Publish, Deploy and authenticated live acceptance retain distinct evidence while correlating the same full SHA and immutable digests.
6. **Recovery:** the exact previous release and durable data can be recovered without broad cleanup, cross-customer impact or silent state loss.

## Acceptance packet for one candidate

- full candidate SHA and clean reviewed checkout;
- successful Backend CI run ID for that SHA;
- successful Publish run ID and exact app/gateway GHCR digests;
- Deploy run ID plus host release-state, running-container and OCI-label readback;
- post-restart live/ready evidence;
- two authenticated users, positive private reads and a denied cross-user read;
- one persisted real turn per user with no duplicate terminal event;
- one approved bounded real effect with provider or controlling-store readback;
- verified backup plus rollback-and-return evidence.

Missing any mandatory item means the candidate is not accepted. A previous release's evidence cannot accept a later commit.
