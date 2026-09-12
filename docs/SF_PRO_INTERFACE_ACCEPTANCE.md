# SF Pro interface — local acceptance

Date: 2026-09-12. Base: `86bb411130333be9f0048cd989907812f9bf8fa4`.

The user approved the PNG preview of the existing Arnall landing screen.
This change applies its shared typography and light palette, sidebar treatment,
composer and suggestion rows. It supersedes the Poppins styling described in
`MINERAL_QUIET_ACCEPTANCE.md`; that file remains historical release evidence.

- Native SF Pro on Apple platforms; system font fallback elsewhere. No Apple
  font binaries are bundled. Geist Mono remains reserved for code.
- Shared type roles use 12, 13, 14 and 24px, weights 400/500 and -0.15px tracking.
  Legacy typography utility names remain compatible aliases.
- Light text hierarchy: #292929, #5D5D5D and #9E9E9E. Dark semantic tokens and
  forced-color fallbacks remain separate.
- Sidebar rows and moving highlights use 8px corners and 14px icons. Active
  navigation uses a light neutral fill. The primary action stays an inverse pill.
- Composer and suggestion rows use 16px corners; suggestion icons use 20px.
  The send action and shared primary CTA use pill corners.
- The composer uses 14px text at both breakpoints, including its measurement
  and mention overlay. Touch controls retain their existing 44px targets.

## Local verification

- Production build, TypeScript and zero-warning ESLint passed.
- Sidebar, reduced-motion and theme suites: 20 tests passed.
- The existing composer collision suite now requires the approved 14px text
  exactly, replacing its former 16px minimum. Its six viewport/theme cases,
  44px targets, focus, geometry and persistence checks remain intact.
- Browser inspection at 1280x720 and 390x844: landing layout, computed font,
  colors/radii, mobile drawer open/close, light/dark theme switching and
  multiline text entry. No horizontal overflow or composer-control overlap.
- Captures were rendered from the local application with synthetic Example
  Laboratory data. No customer data or external model requests were used.
- Build reports six dynamic filesystem tracing warnings in existing backend
  modules. The isolated demo returns 503 for settings/connectors without their
  backend configuration; their end-to-end behavior was not part of this UI check.

No push, Backend CI, GHCR publication, deployment or authenticated production
acceptance is claimed by this local record.
