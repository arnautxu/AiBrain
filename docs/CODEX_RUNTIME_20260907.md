# Codex runtime compatibility, 2026-09-07

An authenticated Expert turn on release 8fcf246 selected gpt-6-astra with medium
reasoning and failed with the provider's newer-CLI requirement. It did not fall
back to another model. The previous runtime was pinned to Codex 0.149.1.

This candidate pins the container binary, entrypoint, readiness check, Compose,
acceptance probe and generated App Server contracts together to 0.153.4. The
contracts are generated from the exact npm release and byte-verified. Approval
fixtures include the new command approval kind; production authorization and
model choices remain unchanged.

Operators must snapshot the controlled host Compose file and update its expected
Codex version before promoting this image. Arnall uses ghcr-ops/compose.yaml as
its candidate input; the transactional release manager retains the prior active
Compose for rollback. MODTIME uses its own compose.yaml plus branding override
and own environment. Never copy installation credentials or data between hosts.
A rollback must restore the previous image and its matching expected version.

Validation gates remain separate: local contract/type/transport checks, Backend
CI, immutable publication, deployment, and an authenticated Expert turn with the
selected model confirmed from durable runtime metadata. A healthy process does
not establish model compatibility.
