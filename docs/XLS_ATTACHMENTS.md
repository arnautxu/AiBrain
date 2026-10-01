# Legacy Excel attachments

Upload acceptance and processing are separate. A bounded binary `.xls` is
preserved privately before processing. Formulas, AutoFilter controls, macros,
external links, encryption or an unsupported processor feature do not by
themselves discard the attachment. Storage still enforces the 16 MiB limit,
filename/MIME agreement, CFB allocation graph, workbook identity and record
bounds. Corrupt containers, renamed executables and HTML/CSV masquerading as XLS
are rejected. Current storage supports CFB v3 with BIFF5/BIFF8 workbook headers;
this is not a claim to support every historical Excel encoding.

The original goes to the existing per-user private legacy vault, outside all
worker/browser mounts. It is never an executable fallback or a preview input.
Permissions, owner resolution, storage admission and original hash checks are
unchanged. Reusing an upload ID with different original bytes remains a conflict.

Processing has three explicit outcomes:

- A recognized BIFF8 workbook follows the existing isolated native conversion,
  preserving supported local formulas, AutoFilter and workbook presentation in
  an independently validated XLSX. The model edits that copy and returns XLSX.
- Other supported BIFF8 workbooks use the isolated passive reader. It reads only
  the bounded Workbook stream and generates a new values-only XLSX. VBA, XLM,
  embedded payloads and external-link refresh are never executed. Formula text
  and saved results carry the existing unverified-data notice.
- If processing is unavailable or fails, the original remains intact and the
  upload succeeds with `storedLegacyExcel.status=unavailable`. The composer says
  **Original guardado · procesamiento no disponible**. Staging contains only a
  generated text receipt, explicitly stating that no cells/results were read.
  The chat can receive that status without receiving original executable bytes
  or inventing workbook contents. Encrypted/BIFF5 inputs take this path without
  invoking a reader. A retry of the same upload ID returns the same receipt;
  it does not silently restart processing.

Optional preview rendering failure also preserves an accepted XLS upload. Its
response has `originalStored=true`, `preview.status=unavailable` and no preview
URLs. Cancellation, identity/integrity failures and storage failures retain
their error behavior. Successful conversions retain their usable derivative.

No original is rewritten. Native conversion fidelity is checked against the
actual supplied workbook, not assumed. Passive data must not be described as
verified or current, and an unavailable processing receipt is not workbook data.
The separate knowledge-catalogue XLS reader is unchanged.

Validation: `npm exec vitest run src/documents tests/integration/document-routes.integration.test.ts`
and `npm run typecheck`. Route regressions exercise private original retention,
native/passive outcomes, processor and preview failures, stable retries and
cross-user denial. Receipt tests prove unsupported/encrypted files invoke no
processor and never enter the turn workbook workspace. Container acceptance
separately checks real isolated native/passive tooling on synthetic fixtures.
Real customer-file conversion, CI, publication, deployment and authenticated
live XLS upload remain separate evidence; local tests do not establish live
acceptance.
