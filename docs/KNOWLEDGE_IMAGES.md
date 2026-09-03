# Image text extraction

The private knowledge reader supports PNG, JPG/JPEG and BMP text extraction with
a Tesseract installation with the `spa+cat+eng` language data. No image is sent to an AI
provider. This is OCR, not visual scene understanding or table reconstruction.
Every nonempty result has locator `image:1`, a verification warning and an explicit
visual/table limitation. Blank OCR remains `EMPTY_TEXT`; it is not evidence that
an image contains no useful visual information. TIFF, GIF, SVG and other formats
remain unsupported by this extension.

The source remains an immutable verified copy. Header checks match the declared
format and reject text/list files disguised as images before invoking Tesseract.
The decoder is limited to 40 million pixels and 25,000 pixels on either edge,
with the existing 16 MiB input, 2 MiB text, 512 MiB address-space, 120-second CPU
and native process timeouts. Tesseract runs for at most 45 seconds. The entire
process stays in the existing unprivileged, networkless bubblewrap sandbox.
Credential-shaped output is not indexable. Caches use revision `located-v5`.

`knowledge-image-acceptance.py` generates a fictional PDF, rasterizes it into PNG
and JPEG and constructs a BMP, then verifies the known OCR phrase and locator.
The acceptance entry point exercises `extract_sandboxed` for all four suffixes.
It does not read Windows files. The protected Linux fixture uses
10,992-byte PNG, 27,901-byte JPG/JPEG and 4,039,254-byte BMP. All 167 knowledge
tests passed on Linux as nobody; nine export-boundary tests passed locally,
including BMP, foreign-root rejection and unrelated-format denial.

The first temporary acceptance unit restricted address families to AF_UNIX and
failed to start the nested sandbox. Adding AF_NETLINK, which the production unit
already permits, allowed bubblewrap to initialize its isolated network namespace.
No IP address family was permitted to the temporary acceptance unit. This changed
only the fixture unit, not production restrictions. The final fixture unit exited
successfully with all four OCR/hash-independent text checks; original source hash
acceptance remains part of real ingestion, not this generated-image fixture.

## Host installation

Follow the legacy-format installation boundary: pause only the knowledge inventory
timer and wait for its actual current invocation to finish. Retain the existing
extractor/ingester/exporter modules and catalogue file. Check their baseline and
candidate hashes, compile replacements, create a private durable backup, then
atomically replace only those modules. A format-only upgrade must preserve the
installed schema; do not install unrelated summary/review schema changes as part
of that upgrade. The original shared importer outside the knowledge directory remains
untouched, as do Windows files/configuration and the running app.

Requeue only supported, size-fitting `unsupported` rows for `.png`, `.jpg`, `.jpeg`
and `.bmp` using `--requeue-supported` and explicit `--format` values. Never reset
withdrawn, denied, oversized or unrelated records. Any real pilot retains the
existing source scopes, lock, resource quotas and Windows/Hetzner hash check.
Resume the timer after the bounded pilot, including failure paths. OCR acceptance
does not establish full corpus coverage or semantic interpretation of images.
