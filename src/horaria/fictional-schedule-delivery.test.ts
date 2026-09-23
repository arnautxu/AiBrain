import { describe, expect, it } from "vitest";
import { requiresFictionalScheduleArtifact } from "./fictional-schedule-delivery";

describe("fictional Arnall schedule delivery gate", () => {
  it("requires an artifact for the reported invented-shop request", () => {
    expect(requiresFictionalScheduleArtifact("arnall", "Cas completament fictici per a una demostració. Genera l'horari de la Botiga Demo amb les sis persones inventades.")).toBe(true);
    expect(requiresFictionalScheduleArtifact("arnall", "Crea un horario ficticio y entrega el Excel.")).toBe(true);
    expect(requiresFictionalScheduleArtifact("arnall", "Vull generar un horari amb dades fictícies.")).toBe(true);
  });

  it("does not redirect real-shop or explanatory turns or another installation", () => {
    expect(requiresFictionalScheduleArtifact("arnall", "Genera l'horari real de S'Agaró.")).toBe(false);
    expect(requiresFictionalScheduleArtifact("arnall", "Per què no ha generat l'horari fictici?")).toBe(false);
    expect(requiresFictionalScheduleArtifact("other", "Crea un horari fictici.")).toBe(false);
  });
});
