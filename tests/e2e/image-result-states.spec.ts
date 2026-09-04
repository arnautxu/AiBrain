import { expect, test, type Page } from "@playwright/test";
import { establishDemoSession } from "../helpers/playwright-auth";
import { generatedPngFixture } from "../helpers/png-fixture";

const artifactId = "018f5f68-4a6e-7abc-8def-0123456789aa";
const imagePrompt = "Descripción extensa para revisar una imagen de prueba " + "sinseparadores".repeat(30);

async function seedImage(page: Page, width = 96, height = 64) {
  await establishDemoSession(page, "example-user");
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.endsWith(".workbench.preview.v1")));
  await page.evaluate(({ id, prompt, width, height }) => {
    const key = Object.keys(localStorage).find((key) => key.endsWith(".workbench.preview.v1"))!;
    const snapshot = JSON.parse(localStorage.getItem(key)!);
    const project = snapshot.projects[0];
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();
    snapshot.threads.unshift({
      id: threadId, projectId: project.id, title: "Imagen de prueba", status: "active", pinned: false, createdAt: now, updatedAt: now,
      messages: [{ id: crypto.randomUUID(), role: "assistant", content: "Resultado de prueba.", createdAt: now, status: "complete", activity: [], plan: [], approvals: [], diff: "", attachments: [],
        artifacts: [{ id, type: "image", name: "prueba.png", prompt, width, height, url: `/api/projects/${project.id}/artifacts/${id}` }] }],
    });
    localStorage.setItem(key, JSON.stringify(snapshot));
    localStorage.setItem(key.slice(0, -"workbench.preview.v1".length) + "selection.v1", JSON.stringify({ activeProjectId: project.id, threadByProject: { [project.id]: threadId } }));
  }, { id: artifactId, prompt: imagePrompt, width, height });
  await page.reload();
}

for (const failure of [401, 403, 404, 503]) {
  test(`image preview recovers from HTTP ${failure} without another turn`, async ({ page }) => {
    let reads = 0;
    let turns = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/chat" && request.method() === "POST") turns++; });
    await page.route(`**/artifacts/${artifactId}`, async (route) => {
      reads++;
      if (reads === 1) await route.fulfill({ status: failure, contentType: "text/plain", body: "Unavailable" });
      else await route.fulfill({ status: 200, contentType: "image/png", body: generatedPngFixture(96, 64) });
    });
    await seedImage(page);
    await expect(page.locator('[data-slot="image-generation"]').getByRole("alert")).toContainText("No se ha podido cargar la imagen");
    await expect(page.getByRole("link", { name: "Descargar prueba.png" })).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a cargar" }).click();
    const image = page.getByRole("img", { name: imagePrompt });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(96);
    await expect(page.getByRole("link", { name: "Descargar prueba.png" })).toBeVisible();
    await expect(page.getByText("Cargando imagen…")).toHaveCount(0);
    expect(reads).toBe(2);
    expect(turns).toBe(0);
    await page.reload();
    await expect(page.getByRole("link", { name: "Descargar prueba.png" })).toBeVisible();
    expect(turns).toBe(0);
  });
}
