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

The mobile conversation assertion expected an idle compact composer, but unchanged
main (`ab0809c`) keeps the controls expanded because the mobile padding exceeds
the desktop multiline threshold. An attempted sizing correction introduced
pointer-click and resize feedback regressions. That product change and all its
compensating logic were removed; this XLS release preserves main's composer
behavior. The visual test now checks the existing visible controls on blur,
focus geometry and preservation of a three-line draft. Compact-on-blur behavior
remains a separate UI issue, not an XLS release change.

The accessibility shell audit waits for finite animations to finish before
measuring sidebar label contrast, avoiding a partly transparent crossfade.
Rules, thresholds and source colors are unchanged by that test stabilization.

Acceptance requires a subsequent complete comparison run without snapshot
updates, using the same pinned Playwright browsers on macOS. Capture generation
alone is not a passing visual regression gate. Backend CI, publication,
deployment and authenticated live acceptance remain separate gates.

That independent comparison completed with **57 passed, 2 pre-existing
platform-specific skips**, no retries and no snapshot writes. The reviewed
reference bytes were then copied unchanged into their normal repository paths
and verified by SHA-256. The two skips select the desktop-only collapsed rail
and mobile-only drawer in their respective projects.

After restoring the original composer implementation, 85 selected candidate
captures matched captures of unchanged main using the existing comparison
thresholds. Only 18 previously adopted references exceeded those thresholds;
their rendered states were reviewed and updated to the preserved main behavior.
The other 111 references were retained. The focused mobile assertion now checks
that input and controls do not overlap instead of a stale 108px minimum
(unchanged main renders 106px). No product sizing or pointer logic remains.

The final independent affected-browser gate completed with 80 passed and the
2 existing platform-specific skips, without retries or snapshot updates:
15 action cases, 57 visual cases and 8 accessibility cases.
