import { test, expect } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`profile glass and supplied avatar ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    // Synthetic identity artwork in the preview only. Production selection is
    // independently covered by profile-avatar.test.ts; no real account changes.
    await page.route("http://127.0.0.1:3100/", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const fixture = body.replaceAll('\\"avatarUrl\\":null', '\\"avatarUrl\\":\\"/branding/arnall/profile-pig.png\\"');
      expect(fixture).not.toBe(body);
      await route.fulfill({ response, body: fixture });
    });
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByRole("button", { name: /Alex/ }).click();
    await expect(page.getByTestId("composer")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("composer")).toBeVisible();
    if (mobile) await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
    const card = page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ });
    const avatar = card.locator("img");
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    expect(await avatar.evaluate((element) => element.getBoundingClientRect().height)).toBe(36);
    expect(await card.evaluate((element) => getComputedStyle(element).backdropFilter)).toContain("blur(24px)");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
      if (!mobile) await expect(page.getByTestId("sidebar-wave").locator("canvas")).toBeVisible();
      await page.getByTestId("workbench-sidebar").screenshot({ path: `.impeccable/review/profile-glass-${mobile ? "mobile" : "desktop"}-${theme}.png` });
    }
    await card.click();
    await expect(page.getByRole("menu", { name: "Cuenta y preferencias" })).toBeVisible();
    if (mobile) {
      await card.click();
      await expect(card).toHaveAttribute("aria-expanded", "false");
    } else {
      await page.getByRole("menuitem", { name: "Configuración", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(card).toBeFocused();
    }
    await page.emulateMedia({ forcedColors: "active" });
    expect(await card.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none");
  });
}
