import { expect, test, type Page } from "@playwright/test";

const demoUserId = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "operations-user" : "example-user";

async function login(page: Page) {
  await page.goto("/login");
  const origin = new URL(page.url()).origin;
  const loginResponse = await page.context().request.post(`${origin}/api/auth/login`, {
    data: { userId: demoUserId },
    headers: { Origin: origin },
  });
  expect(loginResponse.ok()).toBe(true);
  await page.goto("/");
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

test("preferences dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await page.getByRole("button", { name: "Abrir preferencias" }).click();
  const preferences = page.getByRole("dialog", { name: /Preferencias de/ });
  await expect(preferences).toBeVisible();
  await preferences.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await expect(page).toHaveScreenshot("preferences-dark.png", { fullPage: true });
});

test("guided actions dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await page.getByRole("button", { name: "Abrir acciones guiadas" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué quieres conseguir?" })).toBeVisible();
  await expect(page).toHaveScreenshot("guided-actions-dark.png", { fullPage: true });
});

test("employee shell mobile drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual-mobile", "mobile-only interaction");
  await login(page);
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page).toHaveScreenshot("employee-shell-mobile-drawer.png", { fullPage: true });
});

test("completed conversation", async ({ page }) => {
  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Resume este contenido sintético en tres ideas claras.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Detener respuesta" })).toHaveCount(0, { timeout: 10_000 });
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const scroller = page.locator(".workbench-main > .scrollbar-thin");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "Volver al final" })).toHaveCount(0);
  await expect(page).toHaveScreenshot("completed-conversation.png", { fullPage: true });
});

test("completed conversation dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Resume este contenido sintético en tres ideas claras.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Detener respuesta" })).toHaveCount(0, { timeout: 10_000 });
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const scroller = page.locator(".workbench-main > .scrollbar-thin");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page).toHaveScreenshot("completed-conversation-dark.png", { fullPage: true });
});
