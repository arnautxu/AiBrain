import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { usesSchedulePrintArea } from "./spreadsheet-print-layout";

async function workbook(names: string[], area: string) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${names.map(name => `<sheet name="${name}"/>`).join("")}</sheets><definedNames>${area}</definedNames></workbook>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
const names = ["HORARI", "TRACTES", "VACANCES", "PESONAL"];
const area = '<definedName localSheetId="0" name="_xlnm.Print_Area">\'HORARI\'!$B$1:$X$97</definedName>';
describe("schedule print layout", () => {
  it("recognizes quoted sheet names independently of the filename", async () => {
    expect(await usesSchedulePrintArea(await workbook(names, area))).toBe(true);
  });
  it.each([
    [["Sales"], area], [names, ""], [names, area.replace("$X$97", "$ZZ$999")],
    [names, area + area], [names, area.replace('localSheetId="0"', 'localSheetId="1"')],
  ])("keeps unrelated or changed workbook layouts intact", async (sheets, ranges) => {
    expect(await usesSchedulePrintArea(await workbook(sheets as string[], ranges as string))).toBe(false);
  });
});
