import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844], ["narrow", 320, 740]] as const) {
  test(`morphic navigation preserves the chat on ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto("/login");
    await page.getByRole("button", { name: /Alex/ }).click();
    const composer = page.getByTestId("composer").locator("textarea");
    await expect(composer).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Espais de treball" });
    await expect(navigation.getByRole("button", { name: "Xat", exact: true })).toHaveAttribute("aria-pressed", "true");
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: `.impeccable/review/navbar-${name}-light.png` });
    await composer.fill("Aquest esborrany es conserva.");
    for (const label of ["Disseny", "Excel", "Horaris"]) {
      const button = navigation.getByRole("button", { name: label, exact: true });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("region", { name: label, exact: true })).toBeVisible();
      await expect(composer).not.toBeVisible();
      await expect(navigation.locator('[aria-pressed="true"]')).toHaveCount(1);
    }
    await navigation.getByRole("button", { name: "Disseny", exact: true }).click();
    await page.screenshot({ path: `.impeccable/review/navbar-${name}-design.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Tornar al xat" }).click();
    await expect(composer).toHaveValue("Aquest esborrany es conserva.");
    await composer.fill("");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: `.impeccable/review/navbar-${name}-dark.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const button of await navigation.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (name !== "desktop") expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(navigation).toBeVisible();
    await navigation.getByRole("button", { name: "Excel", exact: true }).click();
    expect(await navigation.getByRole("button", { name: "Excel", exact: true }).evaluate((element) => parseFloat(getComputedStyle(element, "::before").transitionDuration))).toBeLessThanOrEqual(0.00001);
    expect(errors).toEqual([]);
  });
}
