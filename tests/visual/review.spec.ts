import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";
const events = [
  { type: "plan", explanation: "Fixture visual", steps: [
    { step: "Inspeccionar el proyecto", status: "completed" },
    { step: "Preparar el cambio", status: "in_progress" },
  ] },
  { type: "activity", item: { id: "command-visual", kind: "command", label: "Comprobar proyecto", detail: "Lectura sintética terminada", output: "status: clean", status: "complete" } },
  { type: "diff", value: "diff --git a/resultado.txt b/resultado.txt\n--- a/resultado.txt\n+++ b/resultado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
  { type: "approval", item: { id: "approval-visual", kind: "command", title: "Ejecutar comprobación", detail: "Comprueba únicamente el estado sintético.", command: "check --synthetic", cwd: "/workspace/synthetic", status: "pending" } },
  { type: "delta", value: "## Resultado preparado\n\nEl turno sintético está listo para revisión." },
  { type: "done" },
];

async function openSyntheticTurn(page: Page) {
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  }));
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Ejecuta una comprobación sintética.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Resultado preparado" })).toBeVisible();
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test("turn activity and approval", async ({ page }) => {
  await openSyntheticTurn(page);
  const approval = page.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
  await approval.scrollIntoViewIfNeeded();
  await expect(approval).toBeVisible();
  await expect(page).toHaveScreenshot("turn-approval.png", { fullPage: true });
});

test("Review diff", async ({ page }) => {
  await openSyntheticTurn(page);
  await page.getByLabel("Abrir Review", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review del turno" })).toBeVisible();
  await expect(page).toHaveScreenshot("review-diff.png", { fullPage: true });
});
