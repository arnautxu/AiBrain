import { expect, test, type Locator, type Page } from "@playwright/test";

const northwind = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa";
const accountName = northwind ? "Taylor" : "Alex";
const productName = northwind ? "Northwind AI" : "Example AI";
const primaryProject = northwind ? "Operacions" : "Espacio principal";

async function login(page: Page) {
  await page.goto("/api/auth/session");
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId("composer")).toBeVisible();
}

async function contentStartX(locator: Locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.x + Number.parseFloat(getComputedStyle(element).paddingLeft || "0");
  });
}

async function expectSidebarContentGuide(page: Page) {
  const guide = await contentStartX(page.getByTestId("sidebar-brand"));
  const rows = [
    page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Nueva conversación" }),
    page.getByTestId("sidebar-chats-label"),
    page.getByTestId("sidebar-projects-label"),
    page.getByTestId("sidebar-project-row").first(),
    page.getByTestId("sidebar-project-thread").first(),
  ];
  for (const row of rows) await expect.poll(() => contentStartX(row)).toBeCloseTo(guide, 0);
}

test("the employee shell exposes work, not implementation details", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  await expect(page.getByRole("img", { name: new RegExp(productName) })).toBeVisible();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByTestId("composer")).toHaveAttribute("data-layout", "landing");
  await expect(page.getByTestId("composer")).not.toHaveClass(/composer-compact/);
  await expect.poll(() => page.getByTestId("composer").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(116);
  await expect(page.getByRole("button", { name: "Nueva conversación" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: primaryProject, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Automatizaciones" })).toBeVisible();
  await expectSidebarContentGuide(page);
  await expect(page.getByRole("button", { name: "Biblioteca" })).toHaveCount(0);
  await expect(page.getByText("Centro de tareas", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Control plane|Supabase|Codex conectado|Runtime|tenant|owner|member/i)).toHaveCount(0);

  const projectButton = page.getByRole("button", { name: primaryProject, exact: true });
  await projectButton.hover({ position: { x: 20, y: 20 } });
  const projectActions = page.getByRole("button", { name: `Acciones de ${primaryProject}` });
  await projectActions.click();
  await expect(page.getByRole("menuitem", { name: "Renombrar" })).toBeVisible();
  await projectActions.click();

  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo proyecto" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();

  await expect(page.getByText("Trabajar", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Modo del turno" })).toHaveCount(0);
  await expect(page.getByLabel("Destino de la conversación")).toContainText(primaryProject);
  await expect(page.getByTestId("project-breadcrumb")).toContainText(primaryProject);
  await expect(page.getByRole("button", { name: /Abrir contexto/ })).toHaveCount(0);
  await expect(page.getByText("⌘K", { exact: true })).toHaveCount(0);

  const addMenuButton = page.getByRole("button", { name: "Añadir al mensaje" });
  await addMenuButton.click();
  const addMenu = page.getByRole("menu", { name: "Añadir al mensaje" });
  await expect(addMenu).toBeVisible();
  await expect(addMenu.getByRole("menuitemcheckbox", { name: /Buscar en la web/ })).toHaveCount(0);
  await expect(addMenu.getByRole("menuitem", { name: "Conectores" })).toBeVisible();
  await expect(addMenu.getByText(/Buscar en la web|Crear imagen|Acciones guiadas/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(addMenu).toBeHidden();

  const accountButton = page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) });
  await accountButton.click();
  const accountMenu = page.getByRole("menu", { name: "Cuenta y preferencias" });
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("menuitem", { name: "Configuración" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(accountMenu).toBeHidden();
  await expect(accountButton).toBeFocused();

  await page.keyboard.press("Meta+K");
  const search = page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill(primaryProject);
  await expect(search.getByRole("option", { name: `${primaryProject} Proyecto`, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();

  const sidebar = page.getByTestId("workbench-sidebar");
  const sidebarWidth = () => sidebar.evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
  await page.waitForTimeout(80);
  const transitioningWidth = await sidebarWidth();
  expect(transitioningWidth).toBeGreaterThan(52);
  expect(transitioningWidth).toBeLessThan(260);
  const rail = page.getByTestId("workbench-sidebar-rail");
  await expect(rail).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-desktop-state", "collapsed");
  await expect.poll(sidebarWidth).toBe(52);
  await expect(rail.getByRole("button", { name: "Mostrar barra lateral" })).toBeFocused();
  await rail.getByRole("button", { name: "Mostrar barra lateral" }).click();
  await expect(sidebar).toHaveAttribute("data-desktop-state", "expanded");
  await expect.poll(sidebarWidth).toBe(260);
  await expect(page.getByRole("button", { name: "Ocultar barra lateral" })).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("project settings owns focus and restores the project action trigger", async ({ page }) => {
  await login(page);
  const project = page.getByRole("button", { name: primaryProject, exact: true });
  await project.hover();
  const projectActions = page.getByRole("button", { name: `Acciones de ${primaryProject}` });
  await projectActions.click();
  await page.getByRole("menuitem", { name: "Ajustes del proyecto" }).click();

  const dialog = page.getByRole("dialog", { name: "Configurar proyecto" });
  const close = dialog.getByRole("button", { name: "Cerrar" });
  const save = dialog.getByRole("button", { name: "Guardar cambios" });
  await expect(close).toBeFocused();

  await save.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(projectActions).toBeFocused();
});

test("the mobile drawer opens and the composer remains available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expectSidebarContentGuide(page);
  const contextTrigger = page.locator('button[aria-label^="Acciones de"]').first();
  await contextTrigger.click();
  await expect(page.getByTestId("workbench-sidebar")).toHaveAttribute("data-context-menu-open", "true");
  await expect(page.locator('button[aria-label^="Acciones de"]:visible')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Cerrar menú" })).toBeVisible();
  await page.getByRole("button", { name: "Automatizaciones", exact: true }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
  await expect(page.getByRole("main", { name: "Automatizaciones" })).toBeVisible();
  await page.getByRole("main", { name: "Automatizaciones" }).getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Nueva conversación" }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
});
