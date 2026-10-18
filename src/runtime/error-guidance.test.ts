import { describe, expect, it } from "vitest";
import { productSafeRuntimeMessage } from "./error-guidance";

describe("plain-language runtime failures", () => {
  it("does not leak internal errors and directs users to the Brain team", () => {
    const result = productSafeRuntimeMessage("Worker runtime failed: token=secret /private/data/user-123");
    expect(result).toContain("no tenemos una causa confirmada");
    expect(result).toContain("Avisa al equipo que gestiona vuestro Brain");
    expect(result).toContain("comprobar su estado antes de repetirla");
    expect(result).not.toMatch(/token=secret|\/private|Worker runtime|user-123/iu);
  });
  it("explains a known timeout without claiming that nothing was saved", () => {
    const result = productSafeRuntimeMessage("request timed out after 90000ms");
    expect(result).toContain("no ha recibido la respuesta");
    expect(result).toContain("Avisa al equipo");
    expect(result).not.toContain("90000");
    expect(result).not.toContain("no se ha guardado");
  });
  it("does not tell employees to widen permissions", () => {
    const result = productSafeRuntimeMessage("permission denied");
    expect(result).toContain("problema de permisos");
    expect(result).toContain("No puedes resolverlo desde esta conversación");
    expect(result).toContain("Avisa al equipo");
  });
  it("gives a bounded next step for temporary saturation and escalation if it persists", () => {
    const result = productSafeRuntimeMessage("Selected model is at capacity. Please try a different model.");
    expect(result).toContain("Vuelve a intentarlo en unos minutos");
    expect(result).toContain("Si el problema continúa");
    expect(result).not.toContain("Selected model");
  });
});
