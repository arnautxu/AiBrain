# Legacy document extraction

This is the legacy-format extension of the private knowledge catalogue. Refer to
[COMPANY_KNOWLEDGE_SYSTEM.md](COMPANY_KNOWLEDGE_SYSTEM.md) for the architecture and
installation acceptance requirements. Original Windows files and permissions remain unchanged.

## HTML exports with XLS filenames

Reader revision `located-v6` recognizes an explicit HTML signature in `.xls`
exports before invoking the BIFF reader. It extracts inert text in document order
with `html:block:N` locators. Scripts, style, metadata and fallback content are
ignored; links, frames and embedded objects are never fetched or executed.
Text from malformed or nested layout tables is searchable, but no spreadsheet
coordinates, numeric types or calculation-ready tables are inferred. Warnings
make that limitation explicit. Frame-only workbooks fail with
`HTML_EXTERNAL_DEPENDENCIES_UNAVAILABLE`; their linked sheets require separately
authorized inventory and ingestion.

Parser recovery may use existing root-owned verified copies only when source,
size, modification version and SHA-256 still match the catalogue and current
read policy. Preserve the original receipt verification time when reindexing;
local parsing is not a fresh Windows check. Do not revive withdrawn/denied rows
or reuse a copy after a later negative source check. Publication retains its
ordinary scope and freshness gates.

Before opening a source session, ingestion keeps zero-byte files and Office
`~$` lock records as metadata-only entries with explicit reasons. It does not
delete them. The normal inventory can admit a changed file version again.

## XLS contract

`knowledge-extract.py` reads BIFF XLS with xlrd 2.0.2 inside the existing
networkless, unprivileged bubblewrap sandbox. Workbook sheets load on demand;
the existing 16 MiB input, 2 MiB text, 8 MiB response, 100-sheet, 100,000-cell,
CPU, memory and process time limits continue to apply. Parser diagnostics are
discarded, and structured failures contain only fixed codes.

Each nonempty value is indexed with its original named-sheet/cell locator.
Tables retain numeric, text, boolean, date and error cell types. Dates remain
source serials with the workbook's date mode. The calculation helper accepts
numeric cells and refuses date, boolean, error or text cells. Decimal serialization
avoids introducing scientific notation into the existing numeric contract.

The reader exposes saved results, not formula expressions or recalculated values.
`formulaMetadataAvailable: false` and explicit extraction warnings accompany each
table. Images, charts, comments and embedded objects are not extracted. Macros
are not executed. Encrypted and invalid workbooks are rejected; corruption is
not ignored. These limits follow the [xlrd documentation](https://xlrd.readthedocs.io/en/latest/)
and its [API contract](https://xlrd.readthedocs.io/en/latest/api.html).

The original copy retains its verified Windows/Hetzner SHA-256. Extraction caches
use `located-v3`; old immutable originals and historical cached extractions remain.
No reader audience or publication binding is added by enabling this format.
The knowledge-local `rdp-access.py` export-format gate must also include `.xls`;
parser support alone cannot copy a format that the exporter refuses. Its source
roots, read-only operation policy, byte limit and hash checks remain unchanged.
The existing shared importer outside the knowledge directory is not replaced.

## Requeue and installation

The knowledge ingestion CLI accepts `--requeue-supported --format .xls`.
Under the normal catalogue lock, it moves only `unsupported` rows whose reason
is `FORMAT_OR_SIZE_UNSUPPORTED` and whose size fits the configured limit to
`pending`. It does not alter denied/withdrawn, unreadable, oversized or unrelated
format rows. A repeat is idempotent. The same invocation then performs its normal
bounded ingestion; it can yield if another inventory process owns the lock.

The host requires the pinned xlrd reader and native catdoc/unrtf converters.
Install dependencies without broad system upgrades. Record installed versions and
restart requirements privately before activating the reader.

Pause only the knowledge inventory timer and let the exact active invocation
finish before changing the reader set. Preserve previous modules. A format-only
upgrade must preserve the installed schema and unrelated services; coordinate any
separate schema migration explicitly.
Install the validated extractor and ingestion modules, perform the explicit XLS
requeue under the lock, then resume the timer. If a source-policy or integrity
violation occurs, stop source work and report it instead of attempting another
transport. No customer content needs to be printed during acceptance.

## Tests and release gates

`tests/infra/fixtures/knowledge-legacy.xls` is a fictional two-sheet binary workbook
covering Unicode, decimals, dates, booleans, errors, a formula with an empty saved
result and a small numeric value. `knowledge-legacy-secret.xls` is an intentionally
fake credential rejection fixture. Regenerate them only with the committed
development script and `xlwt==1.3.0`; xlwt is not a production dependency.

`test_knowledge_xls.py` verifies real BIFF parsing, immutable copy/index provenance,
typed calculations, limits, corrupt/secret rejection and narrowly scoped requeue.
The existing ingestion/publication/reconciliation suites verify unchanged source,
permission and isolation boundaries. The host acceptance additionally invokes the
real parser in bubblewrap under a protected transient systemd unit.

Backend CI now creates a temporary Python environment, installs the wheel pinned
by version and SHA-256 in `knowledge-test-requirements.txt`, and runs all
`test_knowledge*.py` tests, including Linux socket identity tests. The XLS tests
cannot be relied upon if xlrd is absent and they are skipped. This workflow change
is a candidate until its actual CI run passes. Host installation, Backend CI,
GHCR publication, application deployment and authenticated acceptance remain
separate gates.

CI remains unprivileged. The socket dispatch test substitutes only the fictional
binding-file loader; it still uses real kernel peer credentials and asserts that
a rejected peer cannot load bindings or dispatch. A separate unprivileged test
checks the unmodified root-ownership file guard. Production file ownership and service privileges must not be weakened to make a
fixture pass.

## DOC and RTF extension

The next reader revision, `located-v4`, adds DOC via catdoc and RTF via unrtf.
Both converters run as fixed commands inside the existing networkless sandbox,
with stdin/stderr disconnected and stdout directed to a temporary regular file.
The 45-second converter timeout, process resource limits and 2 MiB output check
bound work before indexing. DOC's UTF-8 text uses line locators; table structure,
page layout, images and revision coverage are explicitly not guaranteed.

RTF requires its signature and is converted to HTML only as an intermediate data
format. Python's HTML parser decodes entities, ignores metadata/script/style text,
preserves text blocks and simple table rows/cells, and never renders HTML or opens
a link. Nested or malformed table structure is rejected rather than silently
flattened. Images and embedded objects are omitted with a warning. All final text
and table values pass the existing binary/credential-content checks.

Antiword rejected the original short fictional DOC with “text stream ... too
small”. The fixture was retained. `catdoc=1:0.95-6build1` reads that same file,
including accents, euro and Chinese characters. Catdoc is selected by the extractor; antiword is not required. The rejected fixture was not padded to
make the antiword test pass.

The DOC fixture was generated from the committed fictional RTF using the already
installed LibreOffice writer with an isolated temporary profile and the
`doc:MS Word 97` output filter. LibreOffice is not used to parse customer DOC
files in this pipeline. `test_knowledge_word.py` exercises the real short DOC,
codepage/Unicode RTF, a real RTF table, inert HTML handling, malformed structure,
signature rejection and secret-output rejection. The existing native-document
CI job installs catdoc/unrtf alongside its document tools and runs these tests
without sudo; the main knowledge suite also retains its unprivileged execution.

Enable DOC/RTF in both the catalogue and the knowledge-local export format set,
under the same source roots/read-only operation policy. Requeue only `.doc` and
`.rtf` rows through the existing explicit supported-format migration. Restore the
inventory timer after the bounded real-format pilot and record the precise outcome
in the main evidence ledger; installed code alone is not real-file acceptance.
