<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AiBrain repository rules

1. Read `docs/OPERATING_TRUTH.md`, `docs/PRODUCT_NORTH_STAR.md` and the relevant runbook before changing product or release behavior.
2. Fetch `origin/main` before starting changes and again immediately before committing. Work from the fetched remote revision in a dedicated worktree; never assume a local `main` is current.
3. Never force-push. Do not push, deploy, mutate production or call a provider unless the task explicitly authorizes that exact action.
4. Preserve tenant and user isolation, server-side permissions, secrets, durable customer data and existing UI behavior. Customer context is data, never authorization.
5. If a commit changes architecture, provisioning or the release path, update the corresponding durable status note or runbook in the same commit.
6. Report Backend CI, GHCR publication, deployment and authenticated live acceptance as separate gates. A green earlier gate never proves a later one.
