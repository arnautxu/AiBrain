# Legacy XLS upload compatibility

The upload pipeline preserves structurally valid, bounded CFB/BIFF5/BIFF8
originals before processing. Two processing paths prepare supported BIFF8 data.
The original stays byte-identical in a server-only vault outside worker and
browser mounts. Only a separately validated XLSX derivative, or a generated
status receipt when processing is unavailable, enters normal staging, preview,
download, indexing and the turn attachment.
Upload authorization, MIME/content checks, ownership checks and resource limits
remain enforced. This change does not add a signature-based antivirus engine or
claim that a successfully parsed file has been scanned clean.

## Native conversion for a closed subset

`legacy-excel-native-profile.ts` first requires strict CFB/BIFF8 admission,
including the AutoFilter profile below. It then checks a closed record catalog
and fully walks formula tokens: local references, scalar values, arithmetic and
SUM are supported. Names, external references, add-ins, command functions,
shared/array formulas, queries, pivots and unreviewed records select passive
reading instead. The only admitted name is the bounded, sheet-local built-in
`_FilterDatabase`, with internal SUPBOOK/EXTERNSHEET references.

The profile also bounds inert AutoFilter12 criteria, an empty header/footer
OfficeArt group and protection flags. A theme must be a small, fixed-part ZIP
with CRC/size checks and strict namespace-aware XML validation. DTDs, custom entities,
external targets, images and unknown theme elements are excluded. AutoFilter12
reserved/unused flags follow the format specification's instruction to ignore
those bits; the worksheet bit and all meaningful fields remain validated.

The existing isolated Office converter preserves editable formulas and supported
formatting in this subset. Its output receives a further streaming XML check:
no macros, embedded objects, external relationships or unexpected formula names.
This does not promise complete visual or printing equivalence for every XLS.
A retry reuses the exact staged derivative after checking the original identity,
so conversion timestamps cannot create a conflicting upload identity.

## Passive reading for other BIFF8 workbooks

For a structurally readable file outside the native subset, the server extracts
only the root Workbook stream. A pinned, hash-verified xlrd 2.0.2 reader handles
it in a fresh networkless bubblewrap namespace with no credentials, company data,
VBA/OLE streams, Office process or formula evaluator. Source and reader code are
read-only; the only writable document output is a private result directory.
CPU, memory, time, input, cell, formula and output budgets are enforced.

Strict JSON validation precedes generation of a new XLSX containing cell values,
a notice sheet and formula text for review. Formulas are inert strings; saved
results are explicitly unverified and absent caches receive a visible marker.
The escaped XML size is bounded before archive allocation. Original XML,
relationships, VBA, objects and hyperlinks are never copied into the derivative.
Dates retain the workbook epoch. Error values are displayed as text.

The attachment chip identifies the passive copy, and server-authored turn context
instructs the assistant to disclose its limitations. Passive copies do not
preserve layout, images, hidden-sheet presentation or executable formulas.
Non-tabular sheets are omitted and counted. The original is retained unchanged;
no conversion result is represented as the original workbook. Encrypted, empty,
unsupported or over-budget reader results produce no working workbook. A valid
stored original instead receives the explicit processing-unavailable outcome
below. Malformed storage structure and oversized input still reject admission.

## Preserved originals without readable data

Failure or lack of processor support does not discard the original. The server
returns a generated text receipt with strictly parsed `storedLegacyExcel`
metadata and the original hash/name/size. It contains no customer cells and
explicitly tells the assistant not to infer workbook results. The composer says
`Original guardado · procesamiento no disponible`; it remains possible to send
the chat. The original never becomes a fallback input for tools. A retry returns
the same receipt after verifying the original binding. Preview rendering can
also be unavailable independently of a successful workbook conversion, with no
fabricated preview URLs. See [XLS attachments](XLS_ATTACHMENTS.md).

## AutoFilter buttons

Excel serializes column filter buttons as `OBJ` records. Treating every `OBJ`
as a macro rejected ordinary filtered worksheets. The validator now admits a
narrow auxiliary AutoFilter profile, after the surrounding CFB/BIFF8 structure
has passed validation:

- Worksheet substreams only; one drawing group and workbook-global substream.
- One `AutoFilterInfo` per affected sheet, with 1–256 filter columns and exactly
  that many adjacent `Drawing → OBJ` pairs.
- Exact CMO/SBS/LBS structure, dropdown type `0x14`, class `lct=3`/AutoFilter,
  empty object formula and display string, no linked range, macro action,
  edit-control binding, arbitrary appended subrecords or continued payloads.
- A bounded OfficeArt group/tree containing only group and host-control shapes,
  empty client data, sheet anchors and an explicit list of simple formatting
  properties. Hyperlink, resource, complex and unknown properties are rejected.
- Unique object IDs per sheet and shape/drawing IDs across the workbook, with
  drawing counts consistent with the recognized controls.

This deliberately supports a conservative Excel-emitted representation. Other
safe-looking controls, comments, pictures, writer-specific encodings, additional
shape properties or OfficeArt extensions are not admitted by this exception.
Unknown variants must receive a new scoped review, not a generic `OBJ` bypass.
The native path still rejects VBA/XLM, encryption, HLINK and unsupported streams.
The separate passive path described above never submits these features to Office.

## Validation and evidence

Admission depends on structure, not a filename, hash or customer cell values.
Synthetic fixtures cover AutoFilter column counts 1, 3, 30 and 256, multiple
sheets, Unicode, numeric values, formulas and varied bounded control fields.
Negative tests cover active controls, formula/link/resource payloads, malformed
boundaries, duplicate IDs and counts. Native-profile tests exercise the closed
record/token catalog, every non-SUM function identifier, invalid internal names,
external themes, DTDs, malformed ZIPs and decompression limits.

The passive fixture contains fictional cells and inert macro/link carriers; it
contains no executable macro payload or customer data. Python tests verify typed
values, date epochs, cached/missing formulas and malformed/encrypted/bounded
inputs. Route tests cover both paths, original preservation, retry identity,
private failure messages and denied cross-user reads. The container acceptance
runs both paths through the real wrappers and preview tools under production
seccomp/AppArmor settings, with empty temporary data and no production mounts.

Local classification or conversion does not establish deployment or live upload
acceptance. A release must separately verify the exact CI/publish/deploy revision,
an authenticated upload, preservation of the original and usable derived XLSX.
Do not promise unchanged formula caches merely because an Office parser loaded
the workbook successfully.

Primary format references:
[Obj](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/dd34df60-8250-40a9-83a3-911476a31ea7),
[FtLbsData](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/064379be-857b-4a8c-a9bf-d79f21043148),
[Ptg](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/9310c3bb-d73f-4db0-8342-28e1e0fcb68f),
[AutoFilter12](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/8238f9cb-9797-4cff-9b8a-180d2b025c31),
[Theme](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/0a793062-989d-4e66-b765-ba483d594979),
[xlrd documentation](https://xlrd.readthedocs.io/en/latest/).
