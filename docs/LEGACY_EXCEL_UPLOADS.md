# Legacy XLS upload compatibility

The upload pipeline accepts a bounded subset of Excel 97–2003 CFB/BIFF8. The
original XLS remains private and byte-identical in staging. When a turn needs
an editable workbook, the existing network-isolated document converter produces
a separate XLSX and validates that output again. Antimalware scanning, upload
authorization, limits and staging ownership checks are unchanged.

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
Existing VBA/XLM, encryption, HLINK and unsupported-stream rejection remains.

## Validation and evidence

Admission depends on structure, not a particular filename, hash or customer
cell values. `legacy-excel-autofilter.test.ts` covers 1, 3, 30 and 256 buttons,
multiple sheets and varied bounded control fields, plus active-control, formula,
link, resource, malformed-boundary, duplicate-ID and count negatives.
`legacy-excel-validation.test.ts` verifies both memory/file upload paths, both
accepted MIME declarations and two filenames against five distinct fictional
CFB files: four single-sheet books (1, 3, 30 and 256 columns) and a two-sheet book
(2 and 5 columns). These include Unicode headers, numeric values and cell
formulas, with no customer bytes. Their OfficeArt/OBJ inputs are specified in
`tests/fixtures/legacy-autofilter.ts`; the BIFF cell streams are xlwt-generated.
Optional regeneration instructions are in `tests/fixtures/generate-legacy-autofilter.py`.

This is class-level compatibility, not support for every historical file using
the `.xls` extension. Encrypted workbooks, macros, linked/embedded objects and
other unreviewed structures retain their existing rejection policy.

Local classification or conversion does not establish deployment or live upload
acceptance. A release must separately verify the exact CI/publish/deploy revision,
an authenticated upload, preservation of the original and usable derived XLSX.
Do not promise complete visual/printing equivalence or unchanged formula caches
merely because an Office parser loaded the workbook successfully.

Primary format references:
[Obj](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/dd34df60-8250-40a9-83a3-911476a31ea7),
[FtLbsData](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/064379be-857b-4a8c-a9bf-d79f21043148),
[ObjFmla](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/6859fca9-cef1-4876-8917-0ec88c469357),
[OfficeArtClientData](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/56b0e473-c89b-47a6-929f-aa771ffc1d26),
[OfficeArtFOPT](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/10dc2fe1-9e69-48dc-a1d1-2921dfb9c28e).
