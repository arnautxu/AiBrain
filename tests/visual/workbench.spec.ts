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
  await page.getByRole("button", { name: "Nueva conversación", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /¿En qué te puedo ayudar, .+\?/ })).toBeVisible();
  await expect(page.getByText("Conectando con el servicio…")).toHaveCount(0, { timeout: 10_000 });
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

async function openMobileDrawerIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return;
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();
}

async function installAdministrationRoutes(page: Page) {
  const policy = {
    apps: { "web-search": true, "image-generation": true, skills: true, "managed-browser": true },
    capabilities: { consult: true, respond: true, execute: true, publish: true },
  };
  const role = {
    id: "workspace-owner", name: "Propietario", description: "Administra el espacio de trabajo.",
    canManageWorkspace: true, policy,
  };
  await page.route("**/api/settings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: 1,
      account: { userId: "example-user", displayName: "Alex Example", email: "alex@example.test", provider: "demo", expiresAt: "2099-01-01T00:00:00.000Z" },
      company: { installationId: "example-laboratory", name: "Example Laboratory", isAdmin: true },
      apps: [],
      notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false },
      permissions: [],
      privacy: { conversationStorage: "company_private", providerTraining: "not_managed_here", employeeIsolation: true, memoryScope: "explicit_user_memory" },
      browser: { profileScope: "private_per_employee", networkPolicy: "public_http_https_only", privateNetworkAllowed: false, mutationsRequireApproval: true, downloadsArePrivate: true },
    }),
  }));
  await page.route("**/api/settings/team", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }));
  await page.route("**/api/usage/me", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/api/usage/company", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/api/admin", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: 1,
      installationId: "example-laboratory",
      companyName: "Example Laboratory",
      currentUserRoleId: "workspace-owner",
      identityProvisioning: { mode: "local-profile-only", emailDelivery: false, detail: "El alta se completa en el servidor de la empresa." },
      roles: [role],
      groups: [{
        id: "018f5f68-4a6e-7abc-8def-0123456789c1", name: "Operaciones", description: "Equipo de operaciones internas.",
        memberIds: ["018f5f68-4a6e-7abc-8def-0123456789c2"], policy,
        createdAt: "2026-08-20T09:00:00.000Z", updatedAt: "2026-08-27T09:00:00.000Z",
      }],
      members: [{
        userId: "018f5f68-4a6e-7abc-8def-0123456789c2", displayName: "Alex Example", email: "alex@example.test",
        enabled: true, workerId: "worker-alex", workerState: "running", workerHealthy: true,
        roleId: "workspace-owner", groupIds: ["018f5f68-4a6e-7abc-8def-0123456789c1"],
        usage: { turns: 18, inputTokens: "24500", outputTokens: "8200" },
      }],
      audit: [{
        schemaVersion: 1, installationId: "example-laboratory", actorUserId: "example-user",
        action: "group.updated", targetType: "group", targetId: "018f5f68-4a6e-7abc-8def-0123456789c1",
        summary: "Se revisaron los permisos del grupo Operaciones.", occurredAt: "2026-08-27T09:30:00.000Z", sequence: 1,
      }],
    }),
  }));
}

async function installCompletedTurnRoute(page: Page) {
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    body: [
      { type: "plan", explanation: "Preparando un resumen claro", steps: [
        { step: "Entender el objetivo", status: "completed" },
        { step: "Revisar el contenido", status: "completed" },
        { step: "Preparar el resultado", status: "in_progress" },
      ] },
      { type: "activity", item: { id: "summary-ready", kind: "reasoning", label: "Contenido revisado", detail: "Se han identificado las ideas principales", status: "complete" } },
      { type: "delta", value: "## Vista previa\n\nHe preparado una respuesta sintética con las tres ideas más importantes.\n\n### Resumen\n\n- Objetivo identificado.\n- Información ordenada.\n- Próximos pasos listos para revisar." },
      { type: "done" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n",
  }));
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

test("employee shell collapsed rail light", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual-desktop", "desktop-only sidebar state");
  await login(page);
  await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
  const sidebar = page.getByTestId("workbench-sidebar");
  await expect(sidebar).toHaveAttribute("data-desktop-state", "collapsed");
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(52);
  await expect(page).toHaveScreenshot("employee-shell-collapsed-rail-light.png", { fullPage: true });
});

test("preferences dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await page.getByRole("button", { name: "Abrir preferencias" }).click();
  const preferences = page.getByRole("dialog", { name: /Configuración de/ });
  await expect(preferences).toBeVisible();
  await preferences.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await expect(page).toHaveScreenshot("preferences-dark.png", { fullPage: true });
});

test("guided actions dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await page.getByRole("button", { name: "Añadir al mensaje" }).click();
  await page.getByRole("menuitem", { name: "Acciones guiadas" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué quieres conseguir?" })).toBeVisible();
  await expect(page).toHaveScreenshot("guided-actions-dark.png", { fullPage: true });
});

test("composer tools menu light", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Añadir al mensaje" }).click();
  await expect(page.getByRole("menu", { name: "Añadir al mensaje" })).toBeVisible();
  await expect(page).toHaveScreenshot("composer-tools-menu-light.png", { fullPage: true });
});

test("composer mode menu light", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Modo del turno" }).click();
  await expect(page.getByRole("menu", { name: "Modo del turno" })).toBeVisible();
  await expect(page).toHaveScreenshot("composer-mode-menu-light.png", { fullPage: true });
});

test("account menu light", async ({ page }) => {
  await login(page);
  await openMobileDrawerIfNeeded(page);
  await page.getByRole("button", { name: new RegExp(`${demoUserId === "operations-user" ? "Taylor" : "Alex"}.*Abrir menú de cuenta`) }).click();
  await expect(page.getByRole("menu", { name: "Cuenta y preferencias" })).toBeVisible();
  await expect(page).toHaveScreenshot("account-menu-light.png", { fullPage: true });
});

test("command palette light", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" })).toBeVisible();
  await expect(page).toHaveScreenshot("command-palette-light.png", { fullPage: true });
});

test("library surface light", async ({ page }) => {
  await login(page);
  await openMobileDrawerIfNeeded(page);
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Biblioteca" })).toBeVisible();
  await expect(page.getByText("Cargando biblioteca…")).toBeHidden();
  await expect(page).toHaveScreenshot("library-surface-light.png", { fullPage: true });
});

test("task center surface dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await openMobileDrawerIfNeeded(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Centro de tareas" })).toBeVisible();
  await expect(page).toHaveScreenshot("task-center-surface-dark.png", { fullPage: true });
});

test("scheduled work surface light", async ({ page }) => {
  await login(page);
  await openMobileDrawerIfNeeded(page);
  await page.getByRole("button", { name: "Programadas", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tareas programadas" })).toBeVisible();
  await expect(page.getByText("Cargando tareas…")).toBeHidden();
  await expect(page).toHaveScreenshot("scheduled-work-surface-light.png", { fullPage: true });
});

test("project context surface light", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Abrir contexto de/ }).click();
  await expect(page.getByRole("dialog", { name: "Configurar proyecto" })).toBeVisible();
  await expect(page).toHaveScreenshot("project-context-surface-light.png", { fullPage: true });
});

test("team administration surface dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installAdministrationRoutes(page);
  await login(page);
  await page.getByRole("button", { name: "Abrir preferencias" }).click();
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect(page.getByText("Centro de administración", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("team-administration-surface-dark.png", { fullPage: true });
});

test("create project dialog light", async ({ page }) => {
  await login(page);
  await openMobileDrawerIfNeeded(page);
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo proyecto" })).toBeVisible();
  await expect(page).toHaveScreenshot("create-project-dialog-light.png", { fullPage: true });
});

test("employee shell mobile drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual-mobile", "mobile-only interaction");
  await login(page);
  await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(page).toHaveScreenshot("employee-shell-mobile-drawer.png", { fullPage: true });
});

test("completed conversation", async ({ page }) => {
  await installCompletedTurnRoute(page);
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
  await installCompletedTurnRoute(page);
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
