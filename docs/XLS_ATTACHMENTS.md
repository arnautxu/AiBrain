# Legacy Excel attachments

The document upload boundary accepts binary Excel 97-2003 BIFF8 `.xls` files
with `application/vnd.ms-excel`, up to 16 MiB. Original bytes, hash, filename
and format are retained. They use the existing isolated LibreOffice PDF/PNG preview path. After turn
attachment authorization and hash verification, a separate conversion prepares
an XLSX working copy under the private turn workspace. User and project
authorization is unchanged. The conversion shares installation-wide admission,
uses the networkless headless/safe-mode launcher with a private profile, and
has a 60-second timeout, cancellation and bounded output validation. Its temporary
source/profile directory is removed on success and failure. Failed conversions
abort preparation rather than silently substituting a reconstructed table.

The model is instructed to edit that existing workbook, preserve sheets,
formulas, merges, styles and print settings, save a final `documents/*.xlsx` and
invoke the existing durable `aibrain_documents.deliver` path. The upload remains
XLS, while the edited XLSX is a separate durable downloadable artifact, not a
replacement XLS upload version. Source and working-copy hashes are distinguished.
Conversion does not guarantee full fidelity for every customer workbook; this
must be checked against the actual supplied workbook before customer acceptance.

A bounded CFB allocation-chain and BIFF record inspection rejects cycles,
truncation, mismatched formats, encryption, VBA, Excel 4 macro sheets, embedded
objects and unsupported compound streams. This intentionally does not accept
HTML/CSV renamed to `.xls`, older BIFF versions, chart sheets or macro workbooks.
The knowledge-catalogue XLS reader is a separate path and is unchanged.

Validation: run `npx vitest run src/documents tests/integration/document-routes.integration.test.ts`
and `npm run typecheck`. With LibreOffice and Poppler installed, run
`npx vitest run tests/integration/document-preview.integration.test.ts -t 'real XLS'`.
That test checks real PDF/PNG output, readable turn inputs and unchanged source bytes.
With an openpyxl-capable Python, set `AIBRAIN_XLS_EDIT_TEST_PYTHON` and run the
same integration file with `-t 'editable XLSX'` to check conversion plus editing:
two named sheets, a formula, merged cells, values, styles, column width, print
area and page orientation must survive. The fixture is synthetic and is not
customer-file acceptance.

CI native-document tests install pinned `openpyxl==3.1.5` and set
`AIBRAIN_XLS_EDIT_TEST_PYTHON=/usr/bin/python3` so the structural editing and
durable download tests run rather than skip. This is a test-only dependency.

Local evidence (2026-09-30): bounded conversion and workspace tests, typecheck,
and real LibreOffice 26.8.0.3 XLS preview/conversion/edit tests. See the current
commit handoff for exact passing results; none of these establishes deployment.
The real private workflow also edits a converted fixture, delivers it through
the normal artifact tool, reads the exact edited bytes through the authenticated
artifact download route after deleting the mutable output, and denies a second
user. This is local authenticated route evidence, not an Arnall live session.
Backend CI, GHCR publication, deployment and an authenticated Arnall XLS upload
remain separate release gates. Local implementation does not establish live support.

Live release acceptance identified one additional persistence boundary: chat attachment MIME validation must accept `application/vnd.ms-excel` after server-side document validation. A filesystem-store regression verifies durable XLS attachment readback after restart and denies a different user access. Upload validation and image-only inline input restrictions remain enforced.
