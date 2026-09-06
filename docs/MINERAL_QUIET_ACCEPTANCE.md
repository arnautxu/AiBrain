# Mineral Quiet redesign — local acceptance

Date: 2026-09-06. Base: `ca18298482ff230928618680021d5c48a5f971e4`.
Branch: `codex/mineral-quiet-redesign`.

## Scope

Refinement of the existing AiBrain interface, not a replacement. Poppins
400/500/600, near-binary neutral surfaces, 16/24 reading text, and a translucent
sidebar over a subtle lower radial texture. Installation branding is retained.

Existing sidebar width transitions, measured spring overlays, disclosure,
mobile drawer, keyboard navigation, focus restoration, chat streaming and
action handlers are retained. Static Poppins weights use a same-cell opacity
crossfade for the existing label emphasis. Glass has opaque fallbacks for
reduced transparency, increased contrast and forced colors.

No authentication, permission enforcement, runtime or persistence changes.
The approval button now uses the inverse foreground token to remain readable
in dark mode; its action is unchanged.

## Verified locally

- Production build, standalone TypeScript check and zero-warning ESLint pass.
- Sidebar, reduced-motion UI and theme tests: 17 passing tests.
- Workbench shell and integrated UI browser tests: 5 passing tests on both
  the development preview and optimized build (desktop and mobile viewports).
- Dark-theme accessibility browser test: 1 passing test on the development preview.
- Integrated light/dark desktop and mobile screenshots visually inspected;
  corrected dark approval-button contrast checked again on the optimized build.
- Browser checks assert Poppins, no page errors, no horizontal overflow,
  sidebar controls, mobile drawer, focus restoration and approval text visibility.

The preview uses synthetic `playwright.example.json` data and demo auth,
bound to `127.0.0.1:3100`. Optimized demo auth requires an ephemeral session
secret supplied only to the local server process. No auth fallback was added.

Known tooling notes: build retains two pre-existing dynamic filesystem tracing
warnings in generated-document-artifacts. The design detector reports advisory
legacy small text/radius values; this is not a full migration of every existing
component. `next start` emits a standalone-output launcher warning; the local
optimized browser checks nevertheless pass. This is not deployment acceptance.

## Release gates

Backend CI, GHCR publication, deployment and authenticated live acceptance
have not been run for this branch. No push or production mutation performed.
