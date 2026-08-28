import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const demoUserId = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "operations-user" : "example-user";
const projectId = "018f5f68-4a6e-7abc-8def-0123456789ab";
const documentId = "018f5f68-4a6e-7abc-8def-0123456789ae";
const browserId = "018f5f68-4a6e-7abc-8def-0123456789af";
const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 600, height: 900 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
];

const approvalEvents = [
  { type: "plan", explanation: "Matriz visual sintética", steps: [
    { step: "Inspeccionar el proyecto", status: "completed" },
    { step: "Preparar el resultado", status: "in_progress" },
  ] },
  { type: "activity", item: { id: "matrix-command", kind: "command", label: "Comprobar datos", detail: "Lectura sintética completada", output: "status: clean", status: "complete" } },
  { type: "diff", value: "diff --git a/estado.txt b/estado.txt\n--- a/estado.txt\n+++ b/estado.txt\n@@ -1 +1 @@\n-Pendiente\n+Completado" },
  { type: "approval", item: { id: "018f5f68-4a6e-7abc-8def-012345678931", threadId: "018f5f68-4a6e-7abc-8def-012345678932", turnId: "018f5f68-4a6e-7abc-8def-012345678933", itemId: "018f5f68-4a6e-7abc-8def-012345678934", kind: "command", title: "Ejecutar comprobación", detail: "Comprueba únicamente el estado sintético.", command: "check --synthetic", cwd: "/workspace/synthetic", status: "pending" } },
  { type: "delta", value: "## Resultado preparado\n\nEl turno sintético está listo para revisión." },
  { type: "done" },
];

const documentEvents = [
  { type: "artifact", item: {
    id: documentId, type: "document", name: "informe-sintetico.pdf",
    url: `/api/projects/${projectId}/artifacts/${documentId}`, kind: "pdf",
    mimeType: "application/pdf", size: 42_000, status: "ready", pages: 2,
    previewUrl: `/api/projects/${projectId}/artifacts/${documentId}/preview/1`,
    publicationStatus: "awaiting_confirmation", publicationError: null,
    targetLabel: "Informes/informe-sintetico.pdf", error: null,
  } },
  { type: "delta", value: "## Documento preparado\n\nLa vista previa está lista para revisión segura." },
  { type: "done" },
];

const browserEvents = [
  { type: "artifact", item: {
    id: browserId, type: "browser", name: "Comprobación web sintética", status: "active",
    control: "agent", viewerUrl: `/api/browser/sessions/${browserId}/viewer`,
    captureUrl: null, downloadUrl: `/api/browser/sessions/${browserId}/download`, error: null,
  } },
  { type: "delta", value: "## Sesión preparada\n\nEl viewer aislado está listo para la comprobación." },
  { type: "done" },
];

const turnEvents = [approvalEvents, documentEvents, browserEvents];

async function screenshot(page: Page, name: string, viewport: { width: number; height: number }) {
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow, `${name} must not overflow horizontally`).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot(`${name}-${viewport.width}x${viewport.height}.png`, {
    animations: "allow",
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });
}

async function settleAtWorkbenchBottom(page: Page) {
  const scroller = page.locator("main.workbench-main > div.overflow-y-auto").first();
  await scroller.evaluate((element) => new Promise<void>((resolve) => {
    let stableFrames = 0;
    const observe = () => {
      element.scrollTop = element.scrollHeight;
      const bottomDistance = element.scrollHeight - element.clientHeight - element.scrollTop;
      stableFrames = Math.abs(bottomDistance) < 0.5 ? stableFrames + 1 : 0;
      if (stableFrames >= 12) resolve();
      else requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }));
}

async function centerArtifactInWorkbench(page: Page, target: ReturnType<Page["locator"]>) {
  const scroller = page.locator("main.workbench-main > div.overflow-y-auto").first();
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await scroller.evaluate((element) => new Promise<void>((resolve) => {
    let previous = element.scrollTop;
    let stableFrames = 0;
    const observe = () => {
      const current = element.scrollTop;
      stableFrames = Math.abs(current - previous) < 0.5 ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 12) resolve();
      else requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }));
}

async function installRoutes(page: Page) {
  let turnIndex = 0;
  await page.route("**/api/chat", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    body: `${turnEvents[Math.min(turnIndex++, turnEvents.length - 1)].map((event) => JSON.stringify(event)).join("\n")}\n`,
  }));
  await page.route(`**/api/projects/${projectId}/artifacts/${documentId}/preview/1`, (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#fff"/><rect x="60" y="55" width="840" height="430" rx="18" fill="#f4f4f1" stroke="#d8d7d2"/><text x="105" y="145" font-family="Arial" font-size="34" font-weight="700" fill="#252522">Informe sintético</text><text x="105" y="205" font-family="Arial" font-size="20" fill="#64615c">Vista previa segura · Página 1 de 2</text><rect x="105" y="260" width="570" height="16" rx="8" fill="#d8d7d2"/><rect x="105" y="300" width="690" height="16" rx="8" fill="#e2e1dd"/></svg>',
  }));
  await page.route(`**/api/browser/sessions/${browserId}/viewer`, (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: '<!doctype html><html><body style="margin:0;font-family:Arial;background:#f7f7f5;color:#252522"><header style="padding:14px 20px;background:#fff;border-bottom:1px solid #ddd">Sesión aislada · Datos sintéticos</header><main style="padding:28px"><h1 style="font-size:24px">Comprobación web</h1><p>Viewer temporal de prueba.</p><button style="padding:10px 14px">Elemento interactivo</button></main></body></html>',
  }));
}

async function offlineCapture(page: Page, context: BrowserContext, viewport: { width: number; height: number }) {
  await context.setOffline(true);
  await expect(page.getByText("Sin conexión. El historial sigue disponible y no se enviará nada.")).toBeVisible();
  await screenshot(page, "shell-offline-light", viewport);
  await context.setOffline(false);
  await expect(page.getByText("Sin conexión")).toBeHidden();
}

for (const viewport of viewports) {
  test(`complete state matrix at ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
    let approvalRequestCount = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/runtime/approvals")) approvalRequestCount += 1;
    });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.removeItem("aibrain:theme"));
    await installRoutes(page);

    await page.goto("/login");
    await screenshot(page, "login-light", viewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await screenshot(page, "login-dark", viewport);

    const origin = new URL(page.url()).origin;
    const loginResponse = await page.context().request.post(`${origin}/api/auth/login`, {
      data: { userId: demoUserId },
      headers: { Origin: origin },
    });
    expect(loginResponse.ok()).toBe(true);
    await page.goto("/");
    await expect(page.getByTestId("composer")).toBeVisible();
    await screenshot(page, "shell-dark", viewport);

    await page.getByRole("button", { name: "Abrir preferencias" }).click();
    const preferences = page.getByRole("dialog", { name: /Preferencias de/ });
    await expect(preferences).toBeVisible();
    await preferences.evaluate(async (element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await screenshot(page, "preferences-dark", viewport);
    await page.keyboard.press("Escape");

    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
      await expect(page.getByRole("dialog", { name: "Navegación" })).toBeVisible();
      await screenshot(page, "drawer-dark", viewport);
      await page.keyboard.press("Escape");
    }

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await offlineCapture(page, context, viewport);

    await page.getByRole("textbox", { name: "Mensaje" }).fill("Prepara la matriz visual sintética.");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    await expect(page.getByRole("heading", { name: "Resultado preparado" })).toBeVisible();
    const approval = page.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
    await settleAtWorkbenchBottom(page);
    await expect(approval).toBeInViewport();
    await screenshot(page, "turn-approval-light", viewport);

    await page.getByRole("button", { name: "Revisar cambios" }).click();
    await expect(page.getByRole("heading", { name: "Review del turno" })).toBeVisible();
    await screenshot(page, "review-light", viewport);
    await page.getByRole("button", { name: "Cerrar Review" }).click();
    await page.waitForTimeout(250);
    expect(approvalRequestCount).toBe(0);

    await page.getByRole("textbox", { name: "Mensaje" }).fill("Prepara un documento sintético.");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    const document = page.getByRole("heading", { name: "informe-sintetico.pdf" });
    await expect(document).toBeVisible();
    await page.getByText("Vista previa ›", { exact: true }).click();
    const preview = page.getByRole("img", { name: "Vista previa de informe-sintetico.pdf" });
    await expect(preview).toBeVisible();
    await preview.evaluate((element) => element instanceof HTMLImageElement ? element.decode() : Promise.resolve());
    await centerArtifactInWorkbench(page, document);
    await expect(document).toBeInViewport();
    expect(approvalRequestCount).toBe(0);
    await page.waitForTimeout(250);
    await expect(page.getByText("Esta aprobación ya no está pendiente.")).toBeHidden({ timeout: 6_000 });
    await screenshot(page, "document-light", viewport);
    expect(approvalRequestCount).toBe(0);

    await page.getByRole("textbox", { name: "Mensaje" }).fill("Abre una comprobación web sintética.");
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    const browserHeading = page.getByRole("heading", { name: "Sesión preparada" });
    await expect(browserHeading).toBeVisible();
    const viewer = page.getByRole("link", { name: "Abrir", exact: true });
    await expect(viewer).toBeVisible();
    await centerArtifactInWorkbench(page, browserHeading);
    await expect(viewer).toBeInViewport();
    await expect(viewer).toHaveAttribute("href", `/api/browser/sessions/${browserId}/viewer`);
    await expect(page.locator("iframe")).toHaveCount(0);
    await screenshot(page, "browser-light", viewport);
  });
}
