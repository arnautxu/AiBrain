# Private presentation authoring

This guide is bundled at `/usr/local/share/aibrain/presentations.md` for the
employee worker. It provides local authoring, not authorization for external
services or access to any other employee's files.

## Plan a real deck

Use the user's brief, language, slide count, reference and available design
skill. Decide the story and purpose of each slide before writing the authoring
script. Do not treat the document renderer's title/body fields as a design
engine. It is only suitable for explicitly simple text documents.

Build a deliberate cover, varied compositions and concise content. Use real
authorized local images where useful, native editable charts for data, and
clear type hierarchy. Do not fabricate data, sources, images or company facts.
Do not turn every paragraph into a slide or repeat a heading on overflow pages.
Keep the requested slide count; rewrite dense content instead of splitting it
mid-sentence or shrinking it until unreadable. Missing visual tools are a
limitation to report, never a reason to claim a text dump is a finished design.

## Author without installing packages

Node and a pinned PptxGenJS bundle are available without network access:

```js
const pptxgen = require('/usr/local/share/aibrain/pptxgenjs.cjs');
const deck = new pptxgen();
deck.layout = 'LAYOUT_WIDE';
deck.author = 'Arnall AI';
deck.subject = 'The user-approved subject';
deck.title = 'The presentation title';
deck.lang = 'ca-ES'; // use the requested language
deck.theme = { headFontFace: 'Liberation Sans', bodyFontFace: 'Liberation Sans', lang: 'ca-ES' };
const slide = deck.addSlide();
slide.background = { color: '162821' };
slide.addText('A concise title', { x: 0.7, y: 0.8, w: 11.8, h: 1.2,
  fontSize: 42, bold: true, color: 'FFFFFF', margin: 0 });
// Compose the actual slide; this snippet is only an API example, not a template.
// slide.addImage({ path: authorizedImage, ...deck.imageSizingCrop(authorizedImage, x, y, w, h) });
// slide.addChart(deck.ChartType.bar, [{ name: 'Series', labels: [...], values: [...] }], options);
await deck.writeFile({ fileName: '.aibrain-drafts/deck.pptx' });
```

Use a `.cjs` script with an async main function for the await above, or load the
bundle from ESM with `createRequire`. Dimensions are inches; wide slides are
13.333 × 7.5. Explicit text boxes need `x`, `y`, `w`, `h` and an appropriate font
size. Use `addText`, `addImage`, `addChart`, `addTable` and native objects to
make an editable deck. Use fresh options per object. Do not depend on runtime
npm, npx, pip, downloads or uninstalled libraries.

## Inspect before delivery

Create drafts, scripts, PDF exports and page renders inside `.aibrain-drafts/`
in the authorized project workspace. This directory is excluded from automatic
document delivery. Never place an unfinished deck in `documents/`.

Inside the worker's existing isolated shell, use the installed local binaries:

```sh
mkdir -p .aibrain-drafts/pdf .aibrain-drafts/pages documents
soffice -env:UserInstallation=file:///tmp/presentation-unique-profile --headless --convert-to pdf --outdir .aibrain-drafts/pdf .aibrain-drafts/deck.pptx
pdfinfo .aibrain-drafts/pdf/deck.pdf
pdftotext -layout .aibrain-drafts/pdf/deck.pdf .aibrain-drafts/text.txt
pdftoppm -scale-to 1400 -png .aibrain-drafts/pdf/deck.pdf .aibrain-drafts/pages/slide
```

Use a unique private LibreOffice profile per run. Inspect every rendered page
with the available image-reading tool: clipping, contrast, legibility, empty
pages, repetitive layout and unintended overlap. Check extracted text and page
count against the brief. Fix the script and render again until the actual deck
is acceptable. If image inspection or conversion is unavailable, state that
verification is incomplete; do not claim a visual review.

Only after review, copy the requested formats to distinct final paths under
`documents/`, then print those final paths in a completed shell command. The
application validates and persists them as private artifacts. Do not copy an
intermediate deck: published bytes are immutable. If both PDF and PowerPoint
were requested, deliver the PDF exported from that same reviewed PPTX. A PDF
request does not authorize substituting a PPTX or an A4 text report.

Creating a private requested chat artifact does not authorize publishing to an
external service. Keep all identity, source permissions and private artifact
checks intact.
