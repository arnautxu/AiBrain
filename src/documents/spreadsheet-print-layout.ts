import JSZip from "jszip";
import { SaxesParser } from "saxes";

/** Recognize the schedule's existing print layout; never change source bytes. */
export async function usesSchedulePrintArea(source: Buffer): Promise<boolean> {
  const archive = await JSZip.loadAsync(source);
  const entry = archive.file("xl/workbook.xml");
  if (!entry) return false;
  const xml = await entry.async("string");
  if (xml.length > 1024 * 1024) return false;
  const sheets: string[] = [];
  const areas: Array<{ sheet: string; range: string }> = [];
  let current: { sheet: string; range: string } | null = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("Workbook document types are not supported."); });
  parser.on("opentag", tag => {
    if (tag.uri !== "http://schemas.openxmlformats.org/spreadsheetml/2006/main") return;
    const attr = (name: string) => Object.values(tag.attributes).find(a => a.local === name && a.uri === "")?.value;
    if (tag.local === "sheet") sheets.push(attr("name") ?? "");
    if (tag.local === "definedName" && attr("name") === "_xlnm.Print_Area") {
      current = { sheet: attr("localSheetId") ?? "", range: "" };
      areas.push(current);
    }
  });
  parser.on("text", text => { if (current) current.range += text; });
  parser.on("closetag", tag => { if (tag.local === "definedName") current = null; });
  parser.write(xml).close();
  return sheets.join("|") === "HORARI|TRACTES|VACANCES|PESONAL" && areas.length === 1 &&
    areas[0].sheet === "0" && /^(?:HORARI|'HORARI')!\$B\$1:\$X\$97$/.test(areas[0].range.trim());
}
