import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  BROWSER_FRAME_STREAM_CONTENT_TYPE,
  encodeBrowserFrameStreamRecord,
} from "../../src/ui/browser-frame-stream";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";
const browserSessionId = "018f5f68-4a6e-7abc-8def-0123456789af";

const readyBrowserStatus = {
  available: true,
  capabilityCode: null,
  healthy: true,
  state: {
    browserSessionId,
    lifecycle: "ready",
    controller: "agent",
    generation: 1,
    heartbeatExpiresAt: null,
    downloads: [],
  },
  runtime: { healthy: true },
  runningInProcess: true,
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible();
}

test("system theme follows the OS and reduced motion removes decorative animation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.removeItem("aibrain:theme"));
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menuitem", { name: "Configuración" }).click();
  await expect(page.getByRole("dialog", { name: /Configuración de/ })).toBeVisible();
  await page.getByRole("button", { name: /Tema del sistema/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Tema claro/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /Tema oscuro/ }).click();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  const animationDuration = await page.evaluate(() => {
    const node = document.createElement("div");
    node.className = "message-enter";
    document.body.append(node);
    const duration = getComputedStyle(node).animationDuration;
    node.remove();
    return duration;
  });
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.00001);

  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    Object.defineProperty(window, "__reducedScrollBehaviors", { value: [] as string[], configurable: true });
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      if (typeof options === "object" && options.behavior) {
        (window as typeof window & { __reducedScrollBehaviors: string[] }).__reducedScrollBehaviors.push(options.behavior);
      }
      return original.call(this, options);
    };
  });
  await page.evaluate(() => {
    const previewKey = Object.keys(localStorage).find((key) => key.endsWith(".workbench.preview.v1"));
    if (!previewKey) throw new Error("preview key missing");
    const snapshot = JSON.parse(localStorage.getItem(previewKey) ?? "null");
    const project = snapshot.projects[0];
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();
    snapshot.threads.unshift({
      id: threadId,
      projectId: project.id,
      title: "Movimiento reducido sintético",
      status: "active",
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages: Array.from({ length: 40 }, (_, index) => ({
        id: crypto.randomUUID(), role: index % 2 ? "assistant" : "user",
        content: `Mensaje ${index + 1}: contenido sintético para crear una conversación larga.`,
        createdAt: new Date(Date.now() + index).toISOString(), status: "complete",
        activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [],
      })),
    });
    localStorage.setItem(previewKey, JSON.stringify(snapshot));
    const prefix = previewKey.slice(0, -"workbench.preview.v1".length);
    localStorage.setItem(`${prefix}selection.v1`, JSON.stringify({ activeProjectId: project.id, threadByProject: { [project.id]: threadId } }));
  });
  await page.reload();
  const scroller = page.locator(".workbench-main > .scrollbar-thin");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Volver al final" }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await page.evaluate(() => (window as typeof window & { __reducedScrollBehaviors: string[] }).__reducedScrollBehaviors.at(-1))).toBe("auto");
  expect(await scroller.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(96);
});

test("keyboard dialogs trap focus, close with Escape and restore their opener", async ({ page }) => {
  await login(page);
  const searchTrigger = page.getByRole("button", { name: "Buscar" });
  await searchTrigger.click();
  const palette = page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" });
  const search = page.getByRole("combobox", { name: "Buscar proyectos y conversaciones" });
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(palette.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(searchTrigger).toBeFocused();
});

test("global shortcuts never stack modal surfaces or hijack an editor", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menu", { name: "Cuenta y preferencias" }).getByRole("menuitem", { name: "Configuración" }).click();
  const preferences = page.getByRole("dialog", { name: new RegExp("Configuración de") });
  await expect(preferences).toBeVisible();

  await page.keyboard.press("Meta+K");
  await page.keyboard.press("Meta+Alt+U");
  await expect(preferences).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Buscar proyectos y conversaciones" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Centro de tareas" })).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);

  await page.keyboard.press("Escape");
  const editor = page.getByRole("textbox", { name: "Mensaje" });
  await editor.focus();
  await page.keyboard.press("Meta+Alt+U");
  await expect(editor).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Centro de tareas" })).toHaveCount(0);
});

test("Browser auto-open waits for the blocking surface to close", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.pathname !== "/api/chat") return nativeFetch(input, init);
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          Object.assign(window, {
            __emitBrowserDemand: () => streamController.enqueue(encoder.encode(`${JSON.stringify({
              type: "activity",
              item: {
                id: "browser-demand",
                kind: "tool",
                label: "Preparando navegador",
                detail: "aibrain_browser",
                status: "running",
              },
            })}\n`)),
            __finishBrowserDemand: () => {
              streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", value: "Navegador preparado." })}\n`));
              streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
              streamController.close();
            },
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      });
    };
  });

  let browserStatusRequests = 0;
  await page.route("**/api/settings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: 1,
      account: { userId: "example-user", displayName: accountName, email: "user@example.test" },
      company: { installationId: "example-lab-playwright", name: "Example Laboratory", isAdmin: false },
      apps: [{ id: "managed-browser", label: "Navegador de trabajo", effectiveEnabled: true }],
      notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false },
      permissions: [],
      privacy: {},
      browser: {},
    }),
  }));
  await page.route("**/api/runtime/browser", (route) => {
    browserStatusRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readyBrowserStatus) });
  });
  await page.route("**/api/runtime/browser/token", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token: "synthetic-browser-viewer-token", browserSessionId }),
  }));
  await page.route("**/api/runtime/browser/history?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ history: [] }),
  }));
  await page.route("**/api/runtime/browser/viewer/frame?*", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgIBe3Y8WQAAAABJRU5ErkJggg==", "base64"),
  }));

  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Abre una comprobación web sintética.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { __emitBrowserDemand?: unknown }).__emitBrowserDemand)).toBe("function");

  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menu", { name: "Cuenta y preferencias" }).getByRole("menuitem", { name: "Configuración" }).click();
  const preferences = page.getByRole("dialog", { name: new RegExp("Configuración de") });
  await expect(preferences).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __emitBrowserDemand: () => void }).__emitBrowserDemand());

  await page.waitForTimeout(250);
  await expect(preferences).toBeVisible();
  await expect(page.locator('aside[aria-label="Navegador"]')).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
  expect(browserStatusRequests).toBe(0);

  await page.keyboard.press("Escape");
  await expect(preferences).toBeHidden();
  const browser = page.locator('aside[aria-label="Navegador"]');
  await expect(browser).toBeVisible();
  await expect.poll(() => browserStatusRequests).toBeGreaterThan(0);
  await expect(page.locator("[data-side-window=browser]")).toBeVisible();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { __finishBrowserDemand: () => void }).__finishBrowserDemand());
});

test("Browser stream renders the computer-use cursor and click trail", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.pathname !== "/api/chat") return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          Object.assign(window, {
            __emitPointerTrailDemand: () => {
              controller.enqueue(encoder.encode(`${JSON.stringify({
                type: "activity",
                item: {
                  id: "browser-pointer-trail",
                  kind: "tool",
                  label: "Preparando navegador",
                  detail: "aibrain_browser",
                  status: "running",
                },
              })}\n`));
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
              controller.close();
            },
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
      });
    };
  });

  await page.route("**/api/settings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: 1,
      account: { userId: "example-user", displayName: accountName, email: "user@example.test" },
      company: { installationId: "example-lab-playwright", name: "Example Laboratory", isAdmin: false },
      apps: [{ id: "managed-browser", label: "Navegador de trabajo", effectiveEnabled: true }],
      notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false },
      permissions: [],
      privacy: {},
      browser: {},
    }),
  }));
  await page.route("**/api/runtime/browser", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(readyBrowserStatus),
  }));
  await page.route("**/api/runtime/browser/token", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token: "synthetic-browser-viewer-token", browserSessionId }),
  }));
  await page.route("**/api/runtime/browser/history?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ history: [] }),
  }));
  const frameData = await readFile("tests/visual/capabilities.spec.ts-snapshots/browser-viewer-visual-desktop-darwin.png");
  const frameRecord = encodeBrowserFrameStreamRecord({
    metadata: {
      version: 1,
      kind: "frame",
      sequence: 1,
      capturedAt: new Date().toISOString(),
      captureDurationMs: 12,
      mediaType: "image/png",
      pointerTrail: [
        { id: "click-1", x: 32, y: 44 },
        { id: "click-2", x: 66, y: 58 },
      ],
    },
    data: frameData,
  });
  await page.route("**/api/runtime/browser/viewer/stream?*", (route) => route.fulfill({
    status: 200,
    contentType: BROWSER_FRAME_STREAM_CONTENT_TYPE,
    body: Buffer.from(frameRecord),
  }));

  await login(page);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Muestra el cursor del navegador.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { __emitPointerTrailDemand?: unknown }).__emitPointerTrailDemand)).toBe("function");
  await page.evaluate(() => (window as typeof window & { __emitPointerTrailDemand: () => void }).__emitPointerTrailDemand());

  const browser = page.locator('aside[aria-label="Navegador"]');
  await expect(browser).toBeVisible();
  const pointerTrail = browser.locator('[data-slot="computer-use-trail"]');
  await expect(pointerTrail).toBeVisible();
  await expect(pointerTrail.locator("span")).toHaveCount(2);
  await expect.poll(() => pointerTrail.locator("svg").evaluate((node) => ({
    left: (node as SVGElement).style.left,
    top: (node as SVGElement).style.top,
  }))).toEqual({ left: "66%", top: "58%" });
});

test("desktop notification clicks never stack Task Center over a blocking surface", async ({ page }) => {
  await page.addInitScript(() => {
    // The preview fixture normally uses browser-only task state and therefore disables
    // production polling. Rewrite only its serialized persistence discriminator so this
    // test can exercise the real route-driven notification transition after hydration.
    const rewriteFlightEntry = (entry: unknown) => {
      if (!Array.isArray(entry) || typeof entry[1] !== "string" || !entry[1].includes('"persistence":"browser-preview"')) return entry;
      Object.assign(window, { __rewroteWorkbenchPersistence: true });
      return [entry[0], entry[1].replaceAll('"persistence":"browser-preview"', '"persistence":"filesystem-demo"')];
    };
    let flightQueue: unknown[] | undefined;
    Object.defineProperty(window, "__next_f", {
      configurable: true,
      get: () => flightQueue,
      set: (value: unknown[]) => {
        flightQueue = value;
        for (let index = 0; index < value.length; index += 1) value[index] = rewriteFlightEntry(value[index]);
        const nativePush = value.push.bind(value);
        value.push = (...entries: unknown[]) => nativePush(...entries.map(rewriteFlightEntry));
      },
    });

    class SyntheticNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = async () => "granted" as NotificationPermission;
      onclick: (() => void) | null = null;
      closed = false;

      constructor(readonly title: string, readonly options?: NotificationOptions) {
        const target = window as typeof window & { __syntheticNotifications?: SyntheticNotification[] };
        target.__syntheticNotifications ??= [];
        target.__syntheticNotifications.push(this);
      }

      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: SyntheticNotification });
  });

  await login(page);

  const firstThreadId = "018f5f68-4a6e-7abc-8def-012345678911";
  const firstMessageId = "018f5f68-4a6e-7abc-8def-012345678912";
  const secondThreadId = "018f5f68-4a6e-7abc-8def-012345678921";
  const secondMessageId = "018f5f68-4a6e-7abc-8def-012345678922";
  const task = (threadId: string, messageId: string, status: "running" | "completed") => ({
    id: `${threadId}.${messageId}`,
    threadId,
    projectId: "018f5f68-4a6e-7abc-8def-0123456789ab",
    threadTitle: status === "running" ? "Tarea sintética en curso" : "Tarea sintética completada",
    projectName: "Trabajo interno",
    status,
    title: status === "running" ? "Trabajando en tu solicitud" : "Resultado preparado",
    detail: status === "running" ? "La respuesta continúa." : "El resultado ya está disponible.",
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: status === "running" ? "2026-08-30T10:00:00.000Z" : "2026-08-30T10:00:01.000Z",
    unread: status === "completed",
  });
  let taskStage = 0;
  const observedStages: number[] = [];
  await page.route("**/api/task-center", (route) => {
    const stage = taskStage;
    observedStages.push(stage);
    const tasks = stage === 0
      ? [task(firstThreadId, firstMessageId, "running")]
      : stage === 1
        ? [task(firstThreadId, firstMessageId, "completed")]
        : stage === 2
          ? [task(firstThreadId, firstMessageId, "completed"), task(secondThreadId, secondMessageId, "running")]
          : [task(firstThreadId, firstMessageId, "completed"), task(secondThreadId, secondMessageId, "completed")];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tasks,
        readTaskIds: [],
        preferences: { inApp: true, desktop: true },
        continuity: "worker_required",
      }),
    });
  });

  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __rewroteWorkbenchPersistence?: boolean }).__rewroteWorkbenchPersistence))).toBe(true);
  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`${accountName}.*Abrir menú de cuenta`) }).click();
  await page.getByRole("menu", { name: "Cuenta y preferencias" }).getByRole("menuitem", { name: "Configuración" }).click();
  const preferences = page.getByRole("dialog", { name: new RegExp("Configuración de") });
  await expect(preferences).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => observedStages.filter((stage) => stage === 0).length).toBeGreaterThan(0);

  taskStage = 1;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __syntheticNotifications?: unknown[] }).__syntheticNotifications?.length ?? 0)).toBe(1);
  await page.evaluate(() => {
    const notifications = (window as typeof window & { __syntheticNotifications: Array<{ onclick: (() => void) | null }> }).__syntheticNotifications;
    notifications.at(-1)?.onclick?.();
  });
  await expect(preferences).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Centro de tareas" })).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(preferences).toBeHidden();
  taskStage = 2;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => observedStages.filter((stage) => stage === 2).length).toBeGreaterThan(0);
  taskStage = 3;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __syntheticNotifications?: unknown[] }).__syntheticNotifications?.length ?? 0)).toBe(2);
  await page.evaluate(() => {
    const notifications = (window as typeof window & { __syntheticNotifications: Array<{ onclick: (() => void) | null }> }).__syntheticNotifications;
    notifications.at(-1)?.onclick?.();
  });
  await expect(page.getByRole("dialog", { name: "Centro de tareas" })).toBeVisible();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
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
