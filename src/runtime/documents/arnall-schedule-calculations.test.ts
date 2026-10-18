import { describe, expect, it } from "vitest";
import template from "./templates/arnall-schedule.json";
import { repairArnallScheduleCalculations } from "./arnall-schedule-calculations";

const source = template["xl/worksheets/sheet1.xml"];
const repaired = repairArnallScheduleCalculations(source);
const formula = (address: string) => repaired.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>([\\s\\S]*?)<\\/c>`, "u"))?.[1];

describe("Arnall calculation repair", () => {
  it("eliminates broken references without modifying the immutable original", () => {
    expect(source).toContain("#REF!");
    expect(repaired).not.toContain("#REF!");
    expect(repaired.match(/<f\b/gu)!.length).toBeGreaterThanOrEqual(source.match(/<f\b/gu)!.length);
  });
  it("binds all employee totals and helper rows to the actual two-row slot", () => {
    for (let row = 6; row <= 90; row += 2) {
      expect(formula(`T${row}`)).toContain(`SUM(E${row + 94}:R${row + 95})`);
      expect(formula(`Y${row}`)).toContain(`SUM(E${row + 94}:R${row + 95})`);
      expect(formula(`E${row + 94}`)).toContain(`IF(E${row}="M",`);
      expect(formula(`E${row + 94}`)).toContain(`IF(E${row}="D",`);
      expect(formula(`AC${row}`)).toContain(`COUNTIF(E${row}:R${row},"V")`);
    }
    expect(formula("T47")).toBe('<f>""</f>');
    expect(formula("B132")).toBe('<f>B38</f>');
    expect(formula("E148")).toContain('IF(E54="M",');
  });
  it("does not count sales staff as production staff", () => {
    for (const col of ["E", "G", "I", "K", "M", "O", "Q"]) {
      expect(formula(`${col}96`)).toContain(`${col}54:${col}91`);
      expect(formula(`${col}96`)).not.toContain(`${col}46:`);
    }
  });
  it("distinguishes absent historic balances from a verified numeric zero", () => {
    expect(formula("AA6")).toContain('COUNT(INDEX(PESONAL!$G$2:$G$2060');
    expect(formula("AA6")).toContain('=1,INDEX(');
    expect(formula("AA6")).toContain('"PENDIENTE"');
    expect(formula("AB6")).toContain('IF(ISNUMBER(Z6),Y6-Z6,"PENDIENTE")');
    expect(formula("Z6")).toContain('MONTH($B$5)+9');
    expect(formula("Z6")).not.toContain('$AV$4');
    expect(formula("AD48")).toContain('MATCH($B48,');
    expect(formula("AD48")).not.toContain('$B46');
  });
});
