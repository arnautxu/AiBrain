import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Alex/ }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

test("desktop sidebar keeps account navigation without the decorative gradient", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("sidebar-wave")).toHaveCount(0);
  await expect(page.getByTestId("workbench-sidebar").locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ }).click();
  await expect(page.getByRole("menu", { name: "Cuenta y preferencias" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ })).toBeFocused();
});

test("mobile drawer stays functional without WebGL decoration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page.getByTestId("sidebar-wave").locator("canvas")).toHaveCount(0);
  await page.screenshot({ path: ".impeccable/review/sidebar-wave-mobile.png" });
  await page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ }).click();
  await expect(page.getByRole("menu", { name: "Cuenta y preferencias" })).toBeVisible();
});
