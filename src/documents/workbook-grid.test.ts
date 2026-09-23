import { expect, it } from "vitest";
import { generateLocalDocument } from "@/runtime/documents/local-document-generator";
import { prepareWorkbookGrid } from "@/documents/workbook-grid";

it("opens a wide generated workbook as saved cells across its full column range", async () => {
  const headings = Array.from({ length: 40 }, (_, index) => `Columna ${index + 1}`);
  const generated = await generateLocalDocument({
    format: "xlsx", title: "Full horitzontal", content: "Dades de prova",
    rows: [headings, headings.map((_, index) => `Valor ${index + 1}`)],
  });
  const grid = await prepareWorkbookGrid({ fileName: "full.xlsx", data: generated.data });
  expect(grid.kind).toBe("spreadsheet");
  expect(grid.truncated).toBe(false);
  expect(grid.sheets[0]?.cells).toContainEqual({ address: "AN2", value: "Valor 40" });
});
