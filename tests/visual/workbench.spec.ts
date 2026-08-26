import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByRole("heading", { level: 1, name: "¿En qué trabajamos?" })).toBeVisible();
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test("employee shell light", async ({ page }) => {
  await login(page);
  await expect(page).toHaveScreenshot("employee-shell-light.png", { fullPage: true });
});

test("employee shell dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await expect(page).toHaveScreenshot("employee-shell-dark.png", { fullPage: true });
});

test("employee shell mobile drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual-mobile", "mobile-only interaction");
  await login(page);
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page).toHaveScreenshot("employee-shell-mobile-drawer.png", { fullPage: true });
});
