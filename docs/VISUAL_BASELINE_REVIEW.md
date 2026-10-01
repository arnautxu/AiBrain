# Visual reference review — 2026-10-01

The stored macOS references still depicted the earlier sidebar, typography and
settings layout. The approved interface styling already present on `main`
(`b539978`, baseline `ab0809c`) was not represented by those images. A representative
dark review screenshot failed on unchanged `ab0809c`; the actual image from main
and the XLS candidate was byte-identical (SHA-256
`aefcf64daee778eec428ded7fea1a6aefd73515406daad027b37fa8918e807de`).

The references in this change were captured into a separate review directory,
then inspected as 129 rendered states before adoption. Coverage includes desktop
and mobile light/dark login, conversation, navigation, menus, dialogs, preview,
approval and review, plus the nine existing viewport matrices from 320×568 to
1440×900 and 844×390 landscape. No screenshot tolerance or accessibility rule was
changed, and no additional case was skipped. Existing demo settings/automation
limitations remain explicit in the captures; synthetic PDF previews validate
the panel presentation, not real document conversion.

The review identified and corrected four stale test assumptions:

- Compare the rendered black background rather than CSS source spelling
  (`#000` and `#000000` are equivalent).
- Hover the project row center instead of the separately overlaid disclosure
  control before opening project actions.
- Expect the preview's actual modal `dialog` role below 1280px and its desktop
  `complementary` role above that breakpoint.
- Scroll the approval into view before its landscape capture. Scrolling to the
  very end of the conversation can leave it above a short viewport.

The mobile conversation test also exposed a real existing autosize defect on
unchanged main: one line plus mobile padding exceeded the desktop minimum, so
the composer stayed expanded after blur. Multiline detection now accounts for
the computed one-line height including padding. The test retains compact/expanded
focus assertions and verifies that a three-line draft remains expanded and
unchanged after blur.

The subsequent Chromium gate caught a related interaction regression: collapsing
the composer during pointerdown moved a message action before pointerup, so the
click landed on its container. Pointer-driven blur now preserves the layout until
the gesture ends; keyboard blur still collapses immediately. Browser regression
coverage holds a press on the message editor action and checks its bounds before
release, alongside image-description and shared-document preview actions.

Acceptance requires a subsequent complete comparison run without snapshot
updates, using the same pinned Playwright browsers on macOS. Capture generation
alone is not a passing visual regression gate. Backend CI, publication,
deployment and authenticated live acceptance remain separate gates.

That independent comparison completed with **57 passed, 2 pre-existing
platform-specific skips**, no retries and no snapshot writes. The reviewed
reference bytes were then copied unchanged into their normal repository paths
and verified by SHA-256. The two skips select the desktop-only collapsed rail
and mobile-only drawer in their respective projects.
