# Codex App Server contract 0.149.1

These TypeScript bindings and JSON Schemas are generated artifacts from the
exact Codex version pinned by AiBrain's worker image.

Reproduce them from the repository root:

```bash
npm exec --yes --package=@openai/codex@0.149.1 -- \
  codex app-server generate-ts --experimental \
  --out contracts/codex/0.149.1/types

npm exec --yes --package=@openai/codex@0.149.1 -- \
  codex app-server generate-json-schema --experimental \
  --out contracts/codex/0.149.1/schema
```

Do not edit generated files by hand. Contract tests must fail if the pinned
worker version and this directory diverge.
