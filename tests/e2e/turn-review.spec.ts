import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

test("plan, command, diff and approval decisions consume the typed turn contract inline", async ({ page }) => {
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
      { type: "activity", item: { id: "file-qa", kind: "file", label: "Canvis de fitxers", detail: "src/resultado.ts", files: [{ path: "src/resultado.ts", change: "update" }], status: "complete" } },
      { type: "diff", value: "diff --git a/resultado.txt b/resultado.txt\n--- a/resultado.txt\n+++ b/resultado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
      { type: "approval", item: { id: "approval-command", threadId: "thread-qa", turnId: "turn-qa", itemId: "item-command-qa", kind: "command", title: "Ejecutar comprobación", detail: "Comprueba únicamente el estado sintético.", command: "check --synthetic", cwd: "/workspace/synthetic", status: "pending" } },
      { type: "approval", item: { id: "approval-file", threadId: "thread-qa", turnId: "turn-qa", itemId: "item-file-qa", kind: "file", title: "Aplicar cambio preparado", detail: "Modifica únicamente resultado.txt.", status: "pending" } },
      { type: "delta", value: "## Resultado de la prueba\n\nEl turno está listo para revisión." },
      { type: "done" },
    ];
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
  });
  await page.route("**/api/projects/*/files?*", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ file: {
        path: url.searchParams.get("path"),
        name: "resultado.ts",
        kind: "text",
        mimeType: "text/plain",
        size: 34,
        language: "TypeScript",
        content: "export const resultado = 'listo';",
        previewUrl: null,
        previewMimeType: "text/plain",
        downloadUrl: `/api/projects/00000000-0000-4000-8000-000000000011/files?path=${encodeURIComponent(url.searchParams.get("path") ?? "")}&download=1`,
      } }),
    });
  });

  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Ejecuta el turno sintético de Review.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  const resultHeading = page.getByRole("heading", { name: "Resultado de la prueba" });
  await expect(resultHeading).toBeVisible();
  const assistantTurn = resultHeading.locator("xpath=ancestor::article");
  await assistantTurn.getByRole("button", { name: "Mostrar el proceso de trabajo" }).click();
  await expect(assistantTurn.getByText("Inspeccionar el proyecto", { exact: true })).toBeVisible();
  await expect(page.getByText("Comprobar proyecto")).toBeVisible();
  await expect(page.getByText("Lectura sintética terminada")).toBeVisible();
  await page.getByRole("button", { name: /src\/resultado\.ts/ }).click();
  await expect(page.getByText("export const resultado = 'listo';")).toBeVisible();
  await expect(page.getByText("Cambios preparados", { exact: true })).toBeVisible();

  const commandApproval = page.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
  await commandApproval.getByRole("button", { name: "Permitir", exact: true }).click();
  await expect(commandApproval.getByText("Permitido una vez")).toBeVisible();
  const fileApproval = page.getByRole("group", { name: "Aprobación: Aplicar cambio preparado" });
  await fileApproval.getByRole("button", { name: "Rechazar" }).click();
  await expect(fileApproval.getByText("Acción rechazada")).toBeVisible();
  expect(decisions).toEqual([
    { approvalId: "approval-command", threadId: "thread-qa", turnId: "turn-qa", itemId: "item-command-qa", decision: "accept" },
    { approvalId: "approval-file", threadId: "thread-qa", turnId: "turn-qa", itemId: "item-file-qa", decision: "decline" },
  ]);

  await expect(page.locator('button.result-action[aria-label="Copiar"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar resultados" })).toHaveCount(0);
  await expect(page.getByText("Incluidos en este turno")).toBeVisible();
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
