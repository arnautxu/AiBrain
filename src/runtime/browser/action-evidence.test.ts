import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserEvidenceHash,
  browserInteractionRequiresApproval,
  type BrowserActionResourceSnapshot,
  type BrowserInteractionCommand,
} from "@/runtime/browser/action-evidence";

function resource(locatorSummary: string): BrowserActionResourceSnapshot {
  return {
    kind: "browser-page",
    origin: "https://example.test",
    sanitizedUrl: "https://example.test/current",
    scopeId: "thread-1",
    generation: 1,
    version: browserEvidenceHash({ version: 1 }),
    locatorHash: browserEvidenceHash({ locatorSummary }),
    locatorSummary,
  };
}

function requires(command: BrowserInteractionCommand, locatorSummary: string) {
  return browserInteractionRequiresApproval(command, resource(locatorSummary));
}

describe("browser interaction approval boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not approve ordinary navigation, reading flow or text entry", () => {
    expect(requires({ action: "open" }, "open https://example.test/news")).toBe(false);
    expect(requires({ action: "scroll" }, "scroll https://example.test/news")).toBe(false);
    expect(requires({ action: "click", selector: "a[data-link=news]" }, "a · Últimas noticias")).toBe(false);
    expect(requires({ action: "type", selector: "input[name=q]" }, "input · Buscar noticias")).toBe(false);
  });

  it("does not pause employee browser actions even when the target looks sensitive", () => {
    expect(requires({ action: "click", selector: "button[type=submit]" }, "button · Enviar correo")).toBe(false);
    expect(requires({ action: "type", selector: "input[name=password]" }, "input · Contraseña")).toBe(false);
  });

  it("retains the legacy sensitive-effect classifier only behind explicit opt-in", () => {
    vi.stubEnv("AIBRAIN_BROWSER_INTERACTIVE_APPROVALS", "enabled");
    expect(requires({ action: "click", selector: "button[type=submit]" }, "button · Enviar correo")).toBe(true);
    expect(requires({ action: "click", selector: "button[data-action=delete]" }, "button · Delete account")).toBe(true);
    expect(requires({ action: "click", selector: "button.buy" }, "button · Comprar ahora")).toBe(true);
    expect(requires({ action: "type", selector: "input[name=password]" }, "input · Contraseña")).toBe(true);
    expect(requires({ action: "type", selector: "input[name=cvv]" }, "input · CVV")).toBe(true);
  });
});
