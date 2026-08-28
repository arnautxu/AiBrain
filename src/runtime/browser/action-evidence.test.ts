import { describe, expect, it } from "vitest";
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
  it("does not approve ordinary navigation, reading flow or text entry", () => {
    expect(requires({ action: "open" }, "open https://example.test/news")).toBe(false);
    expect(requires({ action: "scroll" }, "scroll https://example.test/news")).toBe(false);
    expect(requires({ action: "click", selector: "a[data-link=news]" }, "a · Últimas noticias")).toBe(false);
    expect(requires({ action: "type", selector: "input[name=q]" }, "input · Buscar noticias")).toBe(false);
  });

  it("keeps explicit approval for sensitive external effects", () => {
    expect(requires({ action: "click", selector: "button[type=submit]" }, "button · Enviar correo")).toBe(true);
    expect(requires({ action: "click", selector: "button[data-action=delete]" }, "button · Delete account")).toBe(true);
    expect(requires({ action: "click", selector: "button.buy" }, "button · Comprar ahora")).toBe(true);
    expect(requires({ action: "type", selector: "input[name=password]" }, "input · Contraseña")).toBe(true);
    expect(requires({ action: "type", selector: "input[name=cvv]" }, "input · CVV")).toBe(true);
  });
});
