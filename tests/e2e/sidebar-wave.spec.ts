import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Alex/ }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

test("desktop wave is bounded, themed, accessible and stops with its surface", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const wave = page.getByTestId("sidebar-wave");
  await expect(wave).toHaveAttribute("aria-hidden", "true");
  await expect(wave).toHaveAttribute("data-motion", "static");
  await expect(wave.locator("[data-paper-shader] canvas")).toBeVisible();
  const geometry = await wave.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas")!;
    return { height: rect.height, width: rect.width, pixels: canvas.width * canvas.height, pointerEvents: getComputedStyle(element).pointerEvents };
  });
  expect(geometry.height).toBe(220);
  expect(geometry.width).toBeLessThanOrEqual(260);
  expect(geometry.pixels).toBeGreaterThan(0);
  expect(geometry.pixels).toBeLessThanOrEqual(121000);
  expect(geometry.pointerEvents).toBe("none");
  await page.screenshot({ path: ".impeccable/review/sidebar-wave-desktop-light.png" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: ".impeccable/review/sidebar-wave-desktop-dark.png" });
  await page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ }).click();
  await expect(page.getByRole("menu", { name: "Cuenta y preferencias" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(wave).toHaveAttribute("data-motion", "moving");
  await wave.evaluate((element) => { element.style.transform = "translateY(2000px)"; });
  await expect(wave.locator("canvas")).toHaveCount(0);
  await wave.evaluate((element) => { element.style.transform = ""; });
  await expect(wave.locator("canvas")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(wave.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(wave.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar barra lateral", exact: true }).click();
  await expect(wave.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Mostrar barra lateral", exact: true }).click();
  await expect(wave.locator("canvas")).toBeVisible();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(wave.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
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

test("reduced transparency never mounts a shader", async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query === "(prefers-reduced-transparency: reduce)") Object.defineProperty(result, "matches", { value: true });
      return result;
    };
  });
  await login(page);
  await expect(page.getByTestId("sidebar-wave")).toHaveAttribute("data-motion", "off");
  await expect(page.getByTestId("sidebar-wave").locator("canvas")).toHaveCount(0);
});

test("unsupported WebGL leaves the ordinary sidebar usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return args[0] === "webgl2" ? null : getContext.apply(this, args);
    } as typeof getContext;
  });
  await login(page);
  await expect(page.getByTestId("sidebar-wave")).toHaveAttribute("data-motion", "off");
  await expect(page.getByRole("button", { name: /Alex.*Abrir menú de cuenta/ })).toBeVisible();
  expect(errors).toEqual([]);
});
