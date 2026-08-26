import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByRole("heading", { level: 1, name: "¿En qué trabajamos?" })).toBeVisible();
}

test("plan, command, diff, Review and approval decisions consume the typed turn contract", async ({ page }) => {
  const decisions: unknown[] = [];
  await page.route("**/api/runtime/approvals", async (route) => {
    decisions.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/chat", async (route) => {
    const events = [
      { type: "plan", explanation: "Fixture de contrato", steps: [
        { step: "Inspeccionar el proyecto", status: "completed" },
        { step: "Preparar el cambio", status: "in_progress" },
      ] },
      { type: "activity", item: { id: "command-qa", kind: "command", label: "Comprobar proyecto", detail: "Lectura sintética terminada", output: "status: clean", status: "complete" } },
      { type: "diff", value: "diff --git a/resultado.txt b/resultado.txt\n--- a/resultado.txt\n+++ b/resultado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
      { type: "approval", item: { id: "approval-command", kind: "command", title: "Ejecutar comprobación", detail: "Comprueba únicamente el estado sintético.", command: "check --synthetic", cwd: "/workspace/synthetic", status: "pending" } },
      { type: "approval", item: { id: "approval-file", kind: "file", title: "Aplicar cambio preparado", detail: "Modifica únicamente resultado.txt.", status: "pending" } },
      { type: "delta", value: "## Resultado de la prueba\n\nEl turno está listo para revisión." },
      { type: "done" },
    ];
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });

  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Ejecuta el turno sintético de Review.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Resultado de la prueba" })).toBeVisible();
  await expect(page.getByText("Plan")).toBeVisible();
  await expect(page.getByText("Comando completado")).toBeVisible();
  await expect(page.getByText("Lectura sintética terminada")).toBeVisible();
  await expect(page.getByText("Cambios preparados")).toBeVisible();

  const commandApproval = page.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
  await commandApproval.getByRole("button", { name: "Permitir una vez" }).click();
  await expect(commandApproval.getByText("Permitido una vez")).toBeVisible();
  const fileApproval = page.getByRole("group", { name: "Aprobación: Aplicar cambio preparado" });
  await fileApproval.getByRole("button", { name: "Rechazar" }).click();
  await expect(fileApproval.getByText("Acción rechazada")).toBeVisible();
  expect(decisions).toEqual([
    { approvalId: "approval-command", decision: "accept" },
    { approvalId: "approval-file", decision: "decline" },
  ]);

  await page.getByLabel("Abrir Review", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review del turno" })).toBeVisible();
  const review = page.locator("aside.review-panel");
  await expect(review.getByText("resultado.txt", { exact: true }).first()).toBeVisible();
  await expect(review.getByText("+Completado")).toBeVisible();
  await review.getByRole("button", { name: /Actividad/ }).click();
  await review.getByText("Ver salida").click();
  await expect(review.getByText("status: clean")).toBeVisible();
});

test("a network failure is announced without an unhandled page error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Servicio sintético no disponible." }),
  }));

  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Provoca un error de red sintético.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByText("Servicio sintético no disponible.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No se ha podido completar" })).toContainText("No se ha podido completar esta respuesta");
  expect(pageErrors).toEqual([]);
});
