import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";
const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 600, height: 900 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

for (const viewport of viewports) {
  test(`shell and dialogs stay inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await login(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const composer = await page.getByTestId("composer").boundingBox();
    expect(composer).not.toBeNull();
    expect(composer!.x).toBeGreaterThanOrEqual(0);
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(viewport.width + 1);

    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();
    }
    const accountButton = page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) });
    await accountButton.click();
    await page.getByRole("menuitem", { name: "Configuración" }).click();
    const preferences = page.getByRole("dialog", { name: new RegExp("Configuración de") });
    await expect(preferences).toBeVisible();
    await preferences.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const panel = await preferences.boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(panel!.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.keyboard.press("Escape");
    await expect(preferences).toBeHidden();

    if (viewport.width < 768) {
      const sidebarTrigger = page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" });
      await sidebarTrigger.click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeHidden();
      await expect(sidebarTrigger).toBeFocused();
    }

    await page.getByRole("textbox", { name: "Mensaje" }).fill("Comprobar responsive");
    const send = page.getByRole("button", { name: "Enviar mensaje" });
    await expect(send).toBeEnabled();
    if (viewport.width <= 390) {
      const target = await send.boundingBox();
      expect(target).not.toBeNull();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
