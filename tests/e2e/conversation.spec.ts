import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
}

test("the composer grows, accepts dropped images, stops a stream and recovers after reload", async ({ page }) => {
  await login(page);
  const composer = page.getByTestId("composer");
  const textarea = page.getByRole("textbox", { name: "Mensaje" });
  await expect(page.getByText("Conectando con el servicio…", { exact: true })).toHaveCount(0);
  await expect.poll(() => composer.evaluate((element) => getComputedStyle(element.parentElement?.parentElement ?? element).position)).toBe("absolute");
  const initialComposerBox = await composer.boundingBox();
  const initialControlsBox = await composer.locator(".composer-controls").boundingBox();

  await textarea.fill("Primera línea\nSegunda línea\nTercera línea\nCuarta línea");
  await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(56);
  const grownComposerBox = await composer.boundingBox();
  const textareaBox = await textarea.boundingBox();
  const controlsBox = await composer.locator(".composer-controls").boundingBox();
  expect(initialComposerBox).not.toBeNull();
  expect(initialControlsBox).not.toBeNull();
  expect(grownComposerBox).not.toBeNull();
  expect(textareaBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(grownComposerBox!.y).toBeLessThan(initialComposerBox!.y);
  expect(Math.abs((controlsBox!.y + controlsBox!.height) - (initialControlsBox!.y + initialControlsBox!.height))).toBeLessThanOrEqual(2);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(textareaBox!.y + textareaBox!.height - 1);
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled();

  await composer.evaluate((element) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
    transfer.items.add(new File([bytes], "arrastrada.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
  });
  const dropSurface = page.getByRole("button", { name: "Adjuntar un archivo" });
  await expect(dropSurface).toBeVisible();
  await dropSurface.evaluate((element) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
    transfer.items.add(new File([bytes], "arrastrada.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByText("arrastrada.png")).toBeVisible();

  await page.getByLabel("Seleccionar archivos para adjuntar").setInputFiles({
    name: "informe.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText("informe.png")).toBeVisible();
  await expect(page.getByText(/Lista ·/)).toHaveCount(2);

  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  const userMessage = page.locator("article.flex.justify-end").filter({ hasText: "Primera línea" });
  await expect(userMessage).toBeVisible();
  const stop = page.getByRole("button", { name: "Detener respuesta" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByText("Respuesta detenida.")).toBeVisible();
  await expect(page.getByText("informe.png")).toHaveCount(1);

  await page.waitForTimeout(250);
  await page.reload();
  await expect(page.locator("article.flex.justify-end").filter({ hasText: "Primera línea" })).toBeVisible();
  await expect(page.getByText("Respuesta detenida.")).toBeVisible();
});

test("the mobile composer keeps every control below its growing text area", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const composer = page.getByTestId("composer");
  const textarea = page.getByRole("textbox", { name: "Mensaje" });
  await textarea.fill("Primera línea\nSegunda línea\nTercera línea\nCuarta línea");
  await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(56);

  const textareaBox = await textarea.boundingBox();
  const controlsBox = await composer.locator(".composer-controls").boundingBox();
  expect(textareaBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(controlsBox!.y).toBeGreaterThanOrEqual(textareaBox!.y + textareaBox!.height - 1);
  await expect(page.getByRole("button", { name: "Añadir al mensaje" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar mensaje" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("automatic permission review stays inside the existing composer on desktop and mobile", async ({ page }) => {
  await page.route("**/api/runtime/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      tenantId: "example-lab-dev",
      projectId: "018f5f68-4a6e-7abc-8def-0123456789ab",
      projectName: "Trabajo interno",
      mode: "codex",
      codex: "connected",
      isolated: true,
      ready: true,
      authMode: "chatgpt",
      planType: "team",
      processWarm: true,
      rateLimit: null,
      usage: null,
      workspaceName: "workspace",
      model: "gpt-5.6",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      models: [],
      skills: [],
      capabilities: { webSearch: true, imageInput: true, imageGeneration: false },
    }),
  }));
  await login(page);

  const composer = page.getByTestId("composer");
  const control = page.getByRole("button", { name: "Aprobar permisos automáticamente" });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(control).toHaveClass(/composer-tool-active/);

  await page.setViewportSize({ width: 390, height: 844 });
  const composerBox = await composer.boundingBox();
  const controlBox = await control.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(controlBox!.x).toBeGreaterThanOrEqual(composerBox!.x);
  expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
  await expect(control.locator(".composer-auto-approve-label")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("the existing chat route streams a complete turn and persists it in preview storage", async ({ page }) => {
  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Resume este contenido sintético en tres ideas claras.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("button", { name: "Detener respuesta" })).toBeVisible();
  const liveActivity = page.getByTestId("turn-thinking-steps").last();
  const liveActivityTrigger = liveActivity.getByRole("button", { name: "Mostrar el proceso de trabajo" });
  await expect(liveActivityTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(liveActivityTrigger.locator(".thinking-steps-shimmer")).toHaveText(/Analizando la petición|Revisando el proyecto|Plan preparado/);
  await liveActivityTrigger.click();
  await expect(liveActivity.getByText(/Analizando la petición|Revisando el proyecto|Plan preparado/, { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Detener respuesta" })).toHaveCount(0, { timeout: 10_000 });
  const completedActivity = page.getByTestId("turn-thinking-steps").last();
  const completedActivityTrigger = completedActivity.getByRole("button", { name: "Mostrar el proceso de trabajo" });
  await expect(completedActivityTrigger).toHaveAttribute("aria-expanded", "false");
  await completedActivityTrigger.click();
  await expect(completedActivity.getByRole("button", { name: "Ocultar el proceso de trabajo" })).toHaveAttribute("aria-expanded", "true");
  await expect(completedActivity.getByText("Analizando la petición", { exact: true })).toBeVisible();

  await page.waitForTimeout(250);
  await page.reload();
  await expect(page.locator("article.flex.justify-end").filter({ hasText: "Resume este contenido sintético" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible();
});

test("a long recovered conversation keeps the reader in control of scroll", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const previewKey = Object.keys(localStorage).find((key) => key.endsWith(".workbench.preview.v1"));
    if (!previewKey) throw new Error("preview key missing");
    const snapshot = JSON.parse(localStorage.getItem(previewKey) ?? "null");
    const project = snapshot.projects[0];
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: crypto.randomUUID(),
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index % 2 === 0 ? "Pregunta" : "Respuesta"} ${index + 1}: contenido sintético para validar una conversación larga sin datos privados.`,
      createdAt: new Date(Date.now() + index).toISOString(),
      status: "complete",
      activity: [],
      plan: [],
      approvals: [],
      diff: "",
      attachments: [],
      artifacts: [],
    }));
    snapshot.threads.unshift({
      id: threadId,
      projectId: project.id,
      title: "Conversación larga sintética",
      status: "active",
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages,
    });
    localStorage.setItem(previewKey, JSON.stringify(snapshot));
    const prefix = previewKey.slice(0, -"workbench.preview.v1".length);
    localStorage.setItem(`${prefix}selection.v1`, JSON.stringify({
      activeProjectId: project.id,
      threadByProject: { [project.id]: threadId },
    }));
  });
  await page.reload();
  await expect(page.getByText("Respuesta 40:", { exact: false })).toBeVisible();

  const scroller = page.locator(".workbench-main > .scrollbar-thin");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const jump = page.getByRole("button", { name: "Volver al final" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect.poll(() => scroller.evaluate((element) =>
    element.scrollHeight - element.scrollTop - element.clientHeight,
  )).toBeLessThan(100);
});
