import { expect, test, type Page } from "@playwright/test";

const northwind = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa";
const accountName = northwind ? "Taylor" : "Alex";
const productName = northwind ? "Northwind Brain" : "Example Brain";
const primaryProject = northwind ? "Operaciones" : "Trabajo interno";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "¿En qué trabajamos?" })).toBeVisible();
}

test("the employee shell exposes work, not implementation details", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  await expect(page.getByRole("img", { name: new RegExp(productName) })).toBeVisible();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nueva conversación" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: primaryProject, exact: true })).toBeVisible();
  await expect(page.getByText(/Control plane|Automatizaciones|Supabase|Codex conectado|Runtime|tenant|owner|member/i)).toHaveCount(0);

  const projectButton = page.getByRole("button", { name: primaryProject, exact: true });
  await projectButton.hover();
  const projectActions = page.getByRole("button", { name: `Acciones de ${primaryProject}` });
  await projectActions.click();
  await expect(page.getByRole("menuitem", { name: "Renombrar" })).toBeVisible();
  await projectActions.click();

  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Nuevo proyecto" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();

  await page.keyboard.press("Meta+K");
  const search = page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" });
  await expect(search).toBeVisible();
  await search.getByRole("textbox").fill(primaryProject);
  await expect(search.getByRole("option", { name: `${primaryProject} Proyecto`, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test("the mobile drawer opens and the composer remains available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar menú" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
  await expect(page.getByTestId("composer")).toBeVisible();
});
