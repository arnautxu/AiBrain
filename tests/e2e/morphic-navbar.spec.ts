import { test, expect } from "@playwright/test";

for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844], ["narrow", 320, 740]] as const) {
  test(`composer templates replace the draft without obsolete navigation on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/login");
    await page.getByRole("button", { name: /Alex/ }).click();
    const composer = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await expect(composer).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Espais de treball" })).toHaveCount(0);
    await composer.fill("Texto anterior que debe desaparecer.");
    await page.getByRole("button", { name: "Añadir al mensaje", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Añadir al mensaje", exact: true });
    await expect(menu.getByRole("menuitem", { name: "Server", exact: true })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: "Tools", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Adjuntar archivos", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Tareas programadas", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: /Trabajemos en los horarios/ }).click();
    await page.getByRole("menuitem", { name: "Revisar cambios de horarios", exact: true }).click();
    await expect(composer).toHaveValue(/^Revisemos los cambios de horarios/);
    await expect(composer).toBeFocused();
    await expect(menu).toHaveCount(0);
    expect(await page.locator("body").evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
