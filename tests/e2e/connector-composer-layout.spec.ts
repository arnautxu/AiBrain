import { test, expect } from "@playwright/test";

// First navigation may compile the workbench when using the local dev server.
test.setTimeout(60_000);

for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"] as const) {
  test(`shared composer and task collision ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.emulateMedia({ colorScheme: theme });
    const response = await page.goto("/login");
    expect(response?.headers()["permissions-policy"]).toContain("microphone=(self)");
    await page.getByRole("button", { name: /Alex/ }).click();
    await page.waitForURL(/\/$/);
    const input = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeFocused();
    expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    const band = page.getByLabel("Opciones para empezar"), composer = page.getByTestId("composer");
    const a = await band.boundingBox(), b = await composer.boundingBox();
    expect(Math.abs(a!.x - b!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
    const controls = await band.locator('button[aria-label="Destino de la conversación"], button.landing-band-item').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, height: r.height }; }));
    expect(controls.length).toBe(4);
    if (width >= 640) {
      expect(Math.max(...controls.map(r => r.top)) - Math.min(...controls.map(r => r.top))).toBeLessThan(3);
    } else {
      // The project has its own row; secondary actions may wrap on narrow screens.
      expect(Math.min(...controls.slice(1).map(r => r.top))).toBeGreaterThanOrEqual(controls[0].top + controls[0].height);
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const first = controls[i], second = controls[j];
      const overlapsX = Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1;
      const overlapsY = Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top) > 1;
      expect(overlapsX && overlapsY).toBe(false);
    }
    for (const r of controls) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(width); expect(r.height).toBeGreaterThanOrEqual(44); }
    await input.fill("Borrador que se reemplaza.");
    await band.getByRole("button", { name: "Tareas recurrentes", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Tareas recurrentes", exact: true });
    await expect(menu).toBeVisible();
    const popup = page.locator('[data-connector-popover]');
    const r = await popup.boundingBox();
    expect(r!.x).toBeGreaterThanOrEqual(11); expect(r!.x + r!.width).toBeLessThanOrEqual(width - 11);
    if (width < 640) expect(Math.abs(r!.x + r!.width / 2 - width / 2)).toBeLessThan(2);
    await page.screenshot({ path: `.impeccable/review/connector-tasks-${width}-${theme}.png` });
    await page.getByRole("menuitem", { name: /Trabajemos en los horarios/ }).click();
    await expect(page.getByRole("menu", { name: "Horarios del equipo" })).toBeVisible();
    const back = page.getByRole("menuitem", { name: "Volver a las tareas", exact: true });
    await expect(back.locator("svg")).toHaveCount(1);
    await expect(back).toHaveText("");
    await back.click();
    await expect(menu).toBeVisible();
    await page.getByRole("menuitem", { name: /Trabajemos en los horarios/ }).click();
    const child = await popup.boundingBox();
    expect(child!.x).toBeGreaterThanOrEqual(11); expect(child!.x + child!.width).toBeLessThanOrEqual(width - 11);
    await page.getByRole("menuitem", { name: "Revisar cambios de horarios", exact: true }).click();
    await expect(input).toHaveValue(/^Revisemos los cambios de horarios/);
    await expect(input).toBeFocused();
    await page.reload();
    await expect(input).toHaveValue(/^Revisemos los cambios de horarios/);
    expect(await page.locator("body").evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
