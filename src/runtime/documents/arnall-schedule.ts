import template from "./templates/arnall-schedule.json";

export type ArnallSchedule = Readonly<{
  establishmentId: number;
  establishmentName: string;
  week: string;
  people: readonly Readonly<{
    id: number;
    name: string;
    section: "DEPENDIENTA" | "ELABORACION";
    codeHours: Readonly<{ M: number; T: number; D: number }>;
    days: readonly (Readonly<{ code: string; firstLine: string; secondLine: string; requested?: boolean }> | null)[];
  }>[];
}>;

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !Array.from(value).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)));

/** Copies the approved form, changing cell contents only. Never carries other shops. */
export function arnallScheduleParts(input: ArnallSchedule): Record<string, string> {
  if (!input || !Number.isSafeInteger(input.establishmentId) || input.establishmentId < 1 ||
      !text(input.establishmentName, 80) || !input.establishmentName.trim() ||
      !/^\d{4}-W\d{2}$/u.test(input.week) || !Array.isArray(input.people)) throw new Error("Horari de botiga invàlid.");
  const [year, week] = input.week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (week - 1) * 604_800_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  if (year < 1900 || year > 9999 || week < 1 || week > 53 || thursday.getUTCFullYear() !== year) throw new Error("Setmana ISO invàlida.");
  const ids = new Set<number>();
  for (const person of input.people) {
    if (!person || !Number.isSafeInteger(person.id) || person.id < 1 || ids.has(person.id) || !text(person.name, 100) || !person.name.trim() ||
        !["DEPENDIENTA", "ELABORACION"].includes(person.section) || !Array.isArray(person.days) || person.days.length !== 7 ||
        !person.codeHours || [person.codeHours.M, person.codeHours.T, person.codeHours.D].some(h => !Number.isFinite(h) || h < 0 || h > 24) ||
        person.days.some((day: ArnallSchedule["people"][number]["days"][number]) => day !== null && (!day || !/^(?:M|T|D|F|V|B)$/u.test(day.code) || !text(day.firstLine, 60) || !text(day.secondLine, 60) || (day.requested !== undefined && typeof day.requested !== "boolean")))) {
      throw new Error("Persones o torns invàlids per a la plantilla.");
    }
    ids.add(person.id);
  }
  const groups = [input.people.filter(p => p.section === "DEPENDIENTA"), input.people.filter(p => p.section === "ELABORACION")];
  if (groups[0].length > 24 || groups[1].length > 19) throw new Error("La plantilla admet 24 dependents i 19 persones d’obrador. Cal ampliar el model conservant el format abans de proposar aquest horari.");
  const parts: Record<string, string> = { ...template };
  let sheet = parts["xl/worksheets/sheet1.xml"];
  const setInSheet = (xml: string, address: string, value: string | number, allowEmptyCell = false) => {
    const re = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*?)(?:\\s*/>|>[\\s\\S]*?</c>)`, "u");
    if (!re.test(xml)) {
      const row = address.match(/\d+$/u)![0];
      const rowPattern = new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(</row>)`, "u");
      if (!allowEmptyCell || !rowPattern.test(xml)) throw new Error(`Cel·la absent a la plantilla: ${address}`);
      xml = xml.replace(rowPattern, (_, opening: string, contents: string, closing: string) => {
        const list = Array.from(contents.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gu), match => match[0]);
        list.push(`<c r="${address}"/>`);
        const column = (cell: string) => Array.from(cell.match(/\br="([A-Z]+)/u)![1]).reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0);
        return opening + list.sort((a,b) => column(a)-column(b)).join("") + closing;
      });
    }
    return xml.replace(re, (cell: string, attributes: string) => {
      if (/<f(?:\s|>)/u.test(cell)) throw new Error(`No es pot substituir una fórmula original: ${address}`);
      const attrs = attributes.replace(/\s+t="[^"]*"/gu, "");
      return typeof value === "number" ? `<c${attrs}><v>${value}</v></c>` : `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    });
  };
  const set = (address: string, value: string | number) => { sheet = setInSheet(sheet, address, value); };
  // Request-blue is already described by the source legend. Keep the literal
  // shift code unchanged: suffixing SI would break its exact-match formulas.
  const requestedStyles = new Map<string, number>();
  const markRequested = (address: string) => {
    const cell = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>`, "u");
    sheet = sheet.replace(cell, (_, attributes: string) => {
      const original = attributes.match(/\bs="(\d+)"/u)?.[1];
      if (!original) throw new Error("Estil de torn absent.");
      if (!requestedStyles.has(original)) {
        let styles = parts["xl/styles.xml"];
        const xfBlock = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u)![1];
        const xfs = Array.from(xfBlock.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/gu), m => m[0]);
        const base = xfs[Number(original)];
        const fontId = Number(base.match(/\bfontId="(\d+)"/u)![1]);
        const fontBlock = styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/u)![1];
        const fonts = Array.from(fontBlock.matchAll(/<font>[\s\S]*?<\/font>/gu), m => m[0]);
        const blue = fonts[fontId].replace(/<color\b[^>]*\/>/u, '').replace('</font>', '<color rgb="FF305496"/></font>');
        const variant = base.replace(/\bfontId="\d+"/u, `fontId="${fonts.length}"`);
        styles = styles.replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/u, `<fonts count="${fonts.length + 1}">${fontBlock}${blue}</fonts>`)
          .replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/u, `<cellXfs count="${xfs.length + 1}">${xfBlock}${variant}</cellXfs>`);
        parts["xl/styles.xml"] = styles;
        requestedStyles.set(original, xfs.length);
      }
      return `<c${attributes.replace(/\bs="\d+"/u, `s="${requestedStyles.get(original)}"`)}>`;
    });
  };
  set("G4", input.establishmentName); set("D4", week); set("O4", year);
  const cols = ["E", "G", "I", "K", "M", "O", "Q"];
  let auxiliaryRow = 2;
  groups.forEach((people, group) => people.forEach((person, index) => {
    const row = (group === 0 ? 6 : 54) + index * 2;
    set(`B${row}`, person.name);
    // Hour-code mappings are inputs to the original formulas, not replacements
    // for them. Reduced shifts use the actual employee duration.
    set(`AJ${row}`, person.codeHours.M); set(`AO${row}`, person.codeHours.T); set(`AQ${row}`, person.codeHours.D);
    // Only this person's lookup keys enter the three auxiliary tables. Historic
    // balances/monthly agreements remain blank until their real source exists.
    for (const [number, shopColumn] of [[2, "E"], [3, "C"], [4, "K"]] as const) {
      const part = `xl/worksheets/sheet${number}.xml`;
      for (const column of ["A", "B"]) parts[part] = setInSheet(parts[part], `${column}${auxiliaryRow}`, person.name, true);
      parts[part] = setInSheet(parts[part], `${shopColumn}${auxiliaryRow}`, input.establishmentName, true);
    }
    auxiliaryRow++;
    // A source-hidden empty slot must not hide an assigned employee.
    for (const r of [row, row + 1]) sheet = sheet.replace(new RegExp(`<row\\b([^>]*\\br="${r}"[^>]*)>`, "u"), (_, attrs: string) => `<row${attrs.replace(/\s+hidden="1"/u, "")}>`);
    person.days.forEach((day: ArnallSchedule["people"][number]["days"][number], dayIndex: number) => {
      if (!day) return; // Empty means unassigned; it never means a day off.
      const col = cols[dayIndex]; const hours = String.fromCharCode(col.charCodeAt(0) + 1);
      set(`${col}${row}`, day.code);
      set(`${hours}${row}`, day.firstLine);
      set(`${hours}${row + 1}`, day.secondLine);
      if (day.requested) markRequested(`${col}${row}`);
    });
  }));
  // All 2,499 original schedule formulas, including known defects and original
  // overlapping total ranges, remain exactly as supplied by the user.
  parts["xl/worksheets/sheet1.xml"] = sheet;
  return parts;
}
