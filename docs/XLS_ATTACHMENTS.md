# Legacy Excel attachments

The document upload boundary accepts binary Excel 97-2003 BIFF8 `.xls` files
with `application/vnd.ms-excel`, up to 16 MiB. Original bytes, hash, filename
and format are retained. They use the existing isolated LibreOffice PDF/PNG
preview and turn-input extraction path; user and project authorization is unchanged.

A bounded CFB allocation-chain and BIFF record inspection rejects cycles,
truncation, mismatched formats, encryption, VBA, Excel 4 macro sheets, embedded
objects and unsupported compound streams. This intentionally does not accept
HTML/CSV renamed to `.xls`, older BIFF versions, chart sheets or macro workbooks.
The knowledge-catalogue XLS reader is a separate path and is unchanged.

Validation: run `npx vitest run src/documents tests/integration/document-routes.integration.test.ts`
and `npm run typecheck`. With LibreOffice and Poppler installed, run
`npx vitest run tests/integration/document-preview.integration.test.ts -t 'real XLS'`.
That test checks real PDF/PNG output, readable turn inputs and unchanged source bytes.
Backend CI, GHCR publication, deployment and an authenticated Arnall XLS upload
remain separate release gates. Local implementation does not establish live support.
