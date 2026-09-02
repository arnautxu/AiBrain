import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  test(`integrated chat and sidebar ${name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByRole("button", { name: /Alex/ }).click();
    await expect(page.getByTestId("composer")).toBeVisible();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.endsWith(".workbench.preview.v1"))!;
      const snapshot = JSON.parse(localStorage.getItem(key)!);
      const project = snapshot.projects[0];
      const id = crypto.randomUUID();
      const createdAt = "2026-09-02T10:00:00Z";
      const message = { id: crypto.randomUUID(), role: "assistant", createdAt, status: "complete", content: "**Revisión sintética de interfaz.** Las fuentes permanecen vinculadas a los documentos recibidos.", durationMs: 14000,
        activity: [{ id: "read", kind: "file", status: "complete", label: "Documento revisado", sequence: 1 }], plan: [], diff: "", attachments: [], artifacts: [],
        approvals: [{ id: "approval", threadId: id, turnId: "turn", itemId: "item", kind: "file", title: "Aplicar los cambios revisados", detail: "Ejemplo sintético de aprobación. No modifica archivos.", status: "pending" }],
        sources: [
          { id: "web", kind: "web", title: "Documentación de referencia", url: "https://example.com/reference", domain: "example.com", snippet: null, publishedAt: null },
          { id: "file", kind: "file", title: "Informe de revisión.pdf", url: null, domain: null, snippet: null, publishedAt: null },
        ],
        toolResults: [{ id: "tool", kind: "file", status: "complete", title: "Lectura del documento", summary: "Texto sintético", output: "Revisión disponible", sourceIds: ["file"], createdAt, sequence: 2 }],
      };
      snapshot.threads.unshift({ id, projectId: project.id, title: "Revisión sintética de componentes", createdAt, updatedAt: createdAt, status: "active", pinned: false, messages: [message] });
      localStorage.setItem(key, JSON.stringify(snapshot));
      const prefix = key.slice(0, -"workbench.preview.v1".length);
      localStorage.setItem(`${prefix}selection.v1`, JSON.stringify({ activeProjectId: project.id, threadByProject: { [project.id]: id } }));
    });
    await page.reload();
    await expect(page.locator('[data-slot="day-separator"]')).toBeVisible();
    await page.getByRole("button", { name: "Mostrar el proceso de trabajo" }).click();
    await page.getByText("Fuentes", { exact: true }).click();
    for (const slot of ["tool-timeline", "tool-call", "permission-grant", "web-search", "document-reference"]) await expect(page.locator(`[data-slot="${slot}"]`)).toBeVisible();
    await expect(page.locator('[data-slot="memory-chips"]')).toHaveCount(0);
    await page.locator(".workbench-main > .scrollbar-thin").evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.waitForTimeout(300);
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: `.impeccable/review/integrated-${name}.png`, fullPage: true });
    if (name === "mobile") await page.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }).click();
    const sidebar = page.getByTestId("workbench-sidebar");
    await expect(sidebar).toBeVisible();
    const newConversation = sidebar.getByRole("button", { name: "Nueva conversación", exact: true });
    expect(await newConversation.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    if (name === "mobile") await page.screenshot({ path: ".impeccable/review/integrated-mobile-sidebar.png", fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: `.impeccable/review/integrated-${name}-dark.png`, fullPage: true });
    expect(pageErrors).toEqual([]);
  });
}
