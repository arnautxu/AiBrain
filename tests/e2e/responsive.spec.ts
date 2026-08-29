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
  { width: 320, height: 568 },
  { width: 844, height: 390 },
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
    await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();
    }
    await page.getByRole("button", { name: "Nueva conversación", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: /¿(?:En qué te puedo ayudar, .+|Cómo puedo ayudarte en .+)\?/ })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const composer = await page.getByTestId("composer").boundingBox();
    const emptyHeading = await page.getByRole("heading", { level: 1, name: /¿(?:En qué te puedo ayudar, .+|Cómo puedo ayudarte en .+)\?/ }).boundingBox();
    expect(composer).not.toBeNull();
    expect(emptyHeading).not.toBeNull();
    expect(composer!.x).toBeGreaterThanOrEqual(0);
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(composer!.y - (emptyHeading!.y + emptyHeading!.height)).toBeGreaterThanOrEqual(16);

    await page.getByRole("button", { name: "Añadir al mensaje" }).click();
    await page.getByRole("menuitem", { name: "Acciones guiadas" }).click();
    await expect(page.getByRole("heading", { name: "¿Qué quieres conseguir?" })).toBeVisible();
    await expect(page.getByTestId("composer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver todas las acciones" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Prefiero escribir directamente" }).click();
    await expect(page.getByTestId("composer")).toBeVisible();

    await page.getByRole("button", { name: "Experiencia" }).click();
    const experienceMenu = await page.getByRole("menu", { name: "Experiencia" }).boundingBox();
    expect(experienceMenu).not.toBeNull();
    expect(experienceMenu!.x).toBeGreaterThanOrEqual(0);
    expect(experienceMenu!.x + experienceMenu!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");

    if (viewport.width < 768) {
      const header = await page.getByTestId("mobile-app-header").boundingBox();
      expect(header).not.toBeNull();
      expect(header!.x).toBeGreaterThanOrEqual(0);
      expect(header!.x + header!.width).toBeLessThanOrEqual(viewport.width + 1);

      await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();

      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" })).toBeVisible();
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();

      const sidebarAction = page.getByRole("button", { name: /Acciones de/ }).first();
      await expect(sidebarAction).toBeVisible();
      const sidebarActionTarget = await sidebarAction.boundingBox();
      expect(sidebarActionTarget).not.toBeNull();
      expect(sidebarActionTarget!.width).toBeGreaterThanOrEqual(44);
      expect(sidebarActionTarget!.height).toBeGreaterThanOrEqual(44);
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

test("mobile navigation closes when the viewport becomes desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();

  await page.setViewportSize({ width: 768, height: 844 });
  await expect(page.getByRole("dialog", { name: "Navegación" })).toBeHidden();
});

test("settings can recover after its initial request fails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  let settingsRequests = 0;
  await page.route("**/api/settings", async (route) => {
    settingsRequests += 1;
    if (settingsRequests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menuitem", { name: "Configuración" }).click();
  await expect(page.getByRole("dialog", { name: "Navegación" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeHidden();
  await expect.poll(() => settingsRequests).toBe(2);
});
