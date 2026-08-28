import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

test("the authenticated employee shell has no critical or serious axe violations", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByRole("heading", { level: 1, name: "¿En qué trabajamos?" })).toBeVisible();

  const assertNoBlockingViolations = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking).toEqual([]);
  };

  await assertNoBlockingViolations();
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" })).toBeVisible();
  await page.waitForTimeout(300);
  await assertNoBlockingViolations();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menuitem", { name: "Preferencias", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Preferencias de/ })).toBeVisible();
  await page.waitForTimeout(300);
  await assertNoBlockingViolations();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Resume este contenido sintético en tres ideas claras.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Detener respuesta" })).toHaveCount(0, { timeout: 10_000 });
  await assertNoBlockingViolations();
});
