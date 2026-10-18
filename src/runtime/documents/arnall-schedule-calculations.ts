/** Repair the extracted model without rewriting styles, cells or native layout.
 * The immutable source remains available for provenance and geometry checks.
 * Employee slots are two rows; helper row 100 corresponds to schedule row 6.
 */
export function repairArnallScheduleCalculations(source: string): string {
  const pending = '"PENDIENTE"';
  const numericLookup = (row: number, sheet: string, column: string, valueColumn = column) => {
    const index = `MATCH($B${row},${sheet}!$A$2:$A$2060,0)`;
    const value = `INDEX(${sheet}!$${valueColumn}$2:$${valueColumn}$2060,${index})`;
    const cell = `INDEX(${sheet}!$${column}$2:$${column}$2060,${index})`;
    return `IFERROR(IF(COUNT(${cell})=1,${value},${pending}),${pending})`;
  };
  // Two source employee slots had no total cell at all. Add the missing
  // cells inside their existing rows with the adjacent total style.
  const withTotals = source.replace(/<row\b([^>]*\br="(60|66)"[^>]*)>([\s\S]*?)<\/row>/gu,
    (rowXml: string, attrs: string, row: string, content: string) => {
      if (new RegExp(`<c\\b[^>]*\\br="T${row}"`, "u").test(content)) return rowXml;
      const cells = Array.from(content.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gu));
      const index = cells.find(cell => Array.from(cell[1]).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) > 20)?.index ?? content.length;
      return `<row${attrs}>${content.slice(0, index)}<c r="T${row}" s="146"/>${content.slice(index)}</row>`;
    });
  const repaired = withTotals.replaceAll("PESONAL!#REF!", "PESONAL!$A$2:$A$44").replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*?)(?:\s*\/>|>([\s\S]*?)<\/c>)/gu,
    (cell: string, attributes: string, column: string, rowText: string, body = "") => {
      const original = body.match(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/u);
      const row = Number(rowText);
      const personOutput = row >= 6 && row <= 90 && row % 2 === 0 && ["T", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AU", "AV"].includes(column);
      if (!original && !personOutput) return cell;
      let formula: string | undefined;
      if (row >= 100 && /^[E-R]$/u.test(column)) {
        const employeeRow = row - 94;
        // Discard stale calculations below the last employee slot. They have
        // no business input in this form and must not read notes/totals as staff.
        if (employeeRow <= 91 && employeeRow % 2 === 0 && ["E", "G", "I", "K", "M", "O", "Q"].includes(column)) {
          const hoursColumn = String.fromCharCode(column.charCodeAt(0) + 1);
          const duration = (line: number) => {
            const cell = `${hoursColumn}${line}`;
            const startHour = `VALUE(LEFT(${cell},2))`, startMinute = `VALUE(MID(${cell},4,2))`;
            const endHour = `VALUE(MID(${cell},7,2))`, endMinute = `VALUE(RIGHT(${cell},2))`;
            const valid = `AND(LEN(${cell})=11,MID(${cell},3,1)=":",MID(${cell},9,1)=":",OR(MID(${cell},6,1)="–",MID(${cell},6,1)="-"),${startHour}>=0,${startHour}<24,${endHour}>=0,${endHour}<24,${startMinute}>=0,${startMinute}<60,${endMinute}>=0,${endMinute}<60)`;
            return `IFERROR(IF(${valid},ROUND(MOD(${endHour}*60+${endMinute}-${startHour}*60-${startMinute},1440)/60,10),${pending}),${pending})`;
          };
          const morning = duration(employeeRow), afternoon = duration(employeeRow + 1);
          formula = `IF(${column}${employeeRow}="M",${morning},IF(${column}${employeeRow}="T",${afternoon},IF(${column}${employeeRow}="D",IFERROR(${morning}+${afternoon},${pending}),0)))`;
        } else formula = employeeRow <= 91 ? "0" : '""';
      } else if (row >= 100 && column === "B") {
        formula = row <= 185 ? `B${row - 94}` : '""';
      } else if (row >= 6 && row <= 99) {
        const employeeRow = row % 2 === 0 && row <= 90;
        const key = `$B${row}`;
        const onlyPerson = (value: string) => `IF(${key}="","",${value})`;
        if (["T", "Y"].includes(column)) {
          formula = employeeRow ? onlyPerson(`IF(COUNTIF(E${row + 94}:R${row + 95},${pending})>0,${pending},SUM(E${row + 94}:R${row + 95}))`) : '""';
        } else if (column === "AC") {
          formula = employeeRow ? onlyPerson(`COUNTIF(E${row}:R${row},"V")`) : '""';
        } else if (column === "Z") {
          // Month belongs to the scheduled week, never the date of opening Excel.
          const month = `MONTH($B$5)+9`;
          const index = `MATCH(${key},TRACTES!$A$2:$A$490,0)`;
          const value = `INDEX(TRACTES!$A$2:$U$490,${index},${month})`;
          formula = employeeRow ? onlyPerson(`IFERROR(IF(COUNT(${value})=1,${value},${pending}),${pending})`) : '""';
        } else if (["AA", "AD", "AE", "AF", "AG", "AI", "AU"].includes(column)) {
          const lookup: Record<string, [string, string]> = { AA: ["PESONAL", "G"], AD: ["VACANCES", "J"], AE: ["VACANCES", "L"], AF: ["VACANCES", "I"], AG: ["VACANCES", "K"], AI: ["VACANCES", "K"], AU: ["PESONAL", "H"] };
          const [sheet, field] = lookup[column];
          formula = employeeRow ? onlyPerson(numericLookup(row, sheet, field)) : '""';
        } else if (column === "AH") {
          const first = numericLookup(row, "VACANCES", "R");
          const second = numericLookup(row, "VACANCES", "N");
          formula = employeeRow ? onlyPerson(`IF(AND(ISNUMBER(${first}),ISNUMBER(${second})),${first}-${second},${pending})`) : '""';
        } else if (column === "AB") {
          formula = employeeRow ? onlyPerson(`IF(ISNUMBER(Z${row}),Y${row}-Z${row},${pending})`) : '""';
        } else if (column === "AV") {
          formula = employeeRow ? onlyPerson('$G$4') : '""';
        }
        if (row === 96 && /^[E-R]$/u.test(column) && original) {
          // Production staff starts at row 54, after all 24 sales slots.
          formula = original[0].replace(/^<f\b[^>]*>|<\/f>$/gu, "").replace(/([A-Z]+)46:/gu, (_: string, col: string) => `${col}54:`);
        }
      }
      if (formula === undefined) return cell;
      // Replaced formulas are explicit: no shared anchor can point at a
      // different person's row. Cached source values must not survive.
      const attrs = attributes.replace(/\s+t="[^"]*"/gu, "");
      return `<c${attrs}><f>${formula.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</f></c>`;
    });
  if (repaired.includes("#REF!")) throw new Error("Quedan referencias sin resolver en la plantilla de horarios.");
  return repaired;
}
