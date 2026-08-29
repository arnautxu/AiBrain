import { expect, test } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

test("system theme follows the OS and reduced motion removes decorative animation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.removeItem("aibrain:theme"));
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("button", { name: /Tema del sistema/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Tema claro/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /Tema oscuro/ }).click();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const animationDuration = await page.evaluate(() => {
    const node = document.createElement("div");
    node.className = "message-enter";
    document.body.append(node);
    const duration = getComputedStyle(node).animationDuration;
    node.remove();
    return duration;
  });
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.00001);
});

test("keyboard dialogs trap focus, close with Escape and restore their opener", async ({ page }) => {
  await login(page);
  const searchTrigger = page.getByRole("button", { name: "Buscar" });
  await searchTrigger.click();
  const palette = page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" });
  const search = page.getByRole("textbox", { name: "Buscar proyectos y conversaciones" });
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(palette.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(searchTrigger).toBeFocused();
});

test("mobile completed responses expose only the copy action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const events = [
    { type: "diff", value: "diff --git a/estado.txt b/estado.txt\n--- a/estado.txt\n+++ b/estado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
    { type: "delta", value: "## Resultado sintético\n\nListo para revisar." },
    { type: "done" },
  ];
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  }));
  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Prepara un cambio sintético.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Resultado sintético" })).toBeVisible();

  const copy = page.getByRole("button", { name: "Copiar" });
  await expect(copy).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar resultados" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Aprobar resultado|Descargar resultado|Leer en voz alta|Regenerar respuesta|Crear rama/ })).toHaveCount(0);
});

test("runtime failures and offline state fail closed and recover explicitly", async ({ page, context }) => {
  let requests = 0;
  const status = {
    tenantId: "example-lab-dev",
    projectId: "018f5f68-4a6e-7abc-8def-0123456789ab",
    projectName: "Trabajo interno",
    mode: "demo",
    codex: "disabled",
    isolated: true,
    ready: true,
    authMode: null,
    planType: null,
    processWarm: false,
    rateLimit: null,
    usage: null,
    workspaceName: "workspace",
    model: null,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    models: [],
    skills: [],
    capabilities: { webSearch: false, imageInput: true, imageGeneration: false },
  };
  await page.route("**/api/runtime/status**", (route) => {
    requests += 1;
    return requests === 1
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"synthetic"}' })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) });
  });
  await login(page);
  await expect(page.getByText("El servicio no está disponible. Puedes revisar el historial.")).toBeVisible();
  await page.getByRole("textbox", { name: "Mensaje" }).fill("No enviar todavía");
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeDisabled();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText("Sin conexión. El historial sigue disponible y no se enviará nada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText("Sin conexión")).toBeHidden();
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled();
});

test("a successful runtime check cancels its unavailable deadline", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, timeout === 40_000 ? 1_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  await page.route("**/api/runtime/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      tenantId: "example-lab-dev",
      projectId: "018f5f68-4a6e-7abc-8def-0123456789ab",
      projectName: "Trabajo interno",
      mode: "demo",
      codex: "disabled",
      isolated: true,
      ready: true,
      authMode: null,
      planType: null,
      processWarm: false,
      rateLimit: null,
      usage: null,
      workspaceName: "workspace",
      model: null,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      models: [],
      skills: [],
      capabilities: { webSearch: false, imageInput: true, imageGeneration: false },
    }),
  }));

  await login(page);
  await page.waitForTimeout(1_200);
  await expect(page.getByText("El servicio no está disponible. Puedes revisar el historial.")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Comprobar disponibilidad");
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled();
});
