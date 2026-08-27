import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

test("turn approval and Review have no critical or serious axe violations", async ({ page }) => {
  const events = [
    { type: "plan", explanation: null, steps: [{ step: "Revisar el proyecto", status: "completed" }] },
    { type: "activity", item: { id: "command-a11y", kind: "command", label: "Comprobar proyecto", detail: "Lectura sintética terminada", output: "status: clean", status: "complete" } },
    { type: "diff", value: "diff --git a/resultado.txt b/resultado.txt\n--- a/resultado.txt\n+++ b/resultado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
    { type: "approval", item: { id: "018f5f68-4a6e-7abc-8def-012345678901", threadId: "018f5f68-4a6e-7abc-8def-012345678902", turnId: "018f5f68-4a6e-7abc-8def-012345678903", itemId: "018f5f68-4a6e-7abc-8def-012345678904", kind: "command", title: "Ejecutar comprobación", detail: "Comprueba únicamente el estado sintético.", command: "check --synthetic", cwd: "/workspace/synthetic", status: "pending" } },
    { type: "delta", value: "## Resultado preparado\n\nEl turno está listo." },
    { type: "done" },
  ];
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  }));
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Ejecuta una comprobación sintética.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("group", { name: "Aprobación: Ejecutar comprobación" })).toBeVisible();

  const assertNoBlockingViolations = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious",
    )).toEqual([]);
  };
  await assertNoBlockingViolations();
  await page.getByLabel("Abrir Review", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review del turno" })).toBeVisible();
  await assertNoBlockingViolations();
});
