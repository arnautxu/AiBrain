import { expect, test, type Page } from "@playwright/test";
import { generatedPngFixture } from "../helpers/png-fixture";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";
const artifactId = "018f5f68-4a6e-7abc-8def-0123456789aa";
const artifactName = "imagen-webkit.png";
const artifactPrompt = "Imagen PNG visible en Safari móvil";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await expect(page.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
}

test("an authenticated PNG remains visible and downloadable after reload in iPhone WebKit", async ({
  browserName,
  page,
}) => {
  expect(browserName).toBe("webkit");
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });

  const png = generatedPngFixture();
  expect(png.byteLength).toBeGreaterThan(1_024);
  expect(png.subarray(0, pngSignature.length)).toEqual(pngSignature);

  const artifactRequests: Array<{ download: boolean; resourceType: string }> = [];
  await page.route(`**/api/projects/*/artifacts/${artifactId}*`, async (route) => {
    const request = route.request();
    const download = new URL(request.url()).searchParams.get("download") === "1";
    artifactRequests.push({ download, resourceType: request.resourceType() });
    await route.fulfill({
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${artifactName}"`,
        "Content-Length": String(png.byteLength),
        "Content-Type": "image/png",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
      body: png,
    });
  });

  await login(page);
  await page.evaluate(({ id, name, prompt }) => {
    const previewKey = Object.keys(localStorage).find((key) => key.endsWith(".workbench.preview.v1"));
    if (!previewKey) throw new Error("preview key missing");
    const snapshot = JSON.parse(localStorage.getItem(previewKey) ?? "null");
    const project = snapshot.projects[0];
    const threadId = crypto.randomUUID();
    const now = new Date().toISOString();
    snapshot.threads.unshift({
      id: threadId,
      projectId: project.id,
      title: "Entrega PNG móvil",
      status: "active",
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages: [{
        id: crypto.randomUUID(),
        role: "assistant",
        content: "La imagen generada está lista.",
        createdAt: now,
        status: "complete",
        activity: [],
        plan: [],
        approvals: [],
        diff: "",
        attachments: [],
        artifacts: [{
          id,
          type: "image",
          name,
          url: `/api/projects/${project.id}/artifacts/${id}`,
          prompt,
        }],
      }],
    });
    localStorage.setItem(previewKey, JSON.stringify(snapshot));
    const prefix = previewKey.slice(0, -"workbench.preview.v1".length);
    localStorage.setItem(`${prefix}selection.v1`, JSON.stringify({
      activeProjectId: project.id,
      threadByProject: { [project.id]: threadId },
    }));
  }, { id: artifactId, name: artifactName, prompt: artifactPrompt });

  await page.reload();
  const image = page.getByRole("img", { name: artifactPrompt });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    naturalHeight: element.naturalHeight,
    naturalWidth: element.naturalWidth,
  }))).toMatchObject({ complete: true, naturalHeight: 32, naturalWidth: 32 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.reload();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(32);
  expect(artifactRequests.filter((request) => !request.download)).toHaveLength(2);
  expect(artifactRequests.filter((request) => !request.download).every((request) => request.resourceType === "image")).toBe(true);

  const downloadLink = page.getByRole("link", { name: `Descargar ${artifactName}` });
  await expect(downloadLink).toHaveAttribute(
    "href",
    new RegExp(`/api/projects/[0-9a-f-]{36}/artifacts/${artifactId}\\?download=1$`, "i"),
  );

  const response = await downloadLink.evaluate(async (element: HTMLAnchorElement) => {
    const downloadResponse = await fetch(element.href, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
    return {
      contentDisposition: downloadResponse.headers.get("content-disposition"),
      contentLength: downloadResponse.headers.get("content-length"),
      contentType: downloadResponse.headers.get("content-type"),
      length: bytes.byteLength,
      signature: Array.from(bytes.slice(0, 8)),
      status: downloadResponse.status,
    };
  });
  expect(response).toMatchObject({
    contentDisposition: `attachment; filename="${artifactName}"`,
    contentLength: String(png.byteLength),
    contentType: "image/png",
    length: png.byteLength,
    signature: Array.from(pngSignature),
    status: 200,
  });
  expect(response.length).toBeGreaterThan(1_024);
  expect(artifactRequests).toContainEqual({ download: true, resourceType: "fetch" });

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(artifactName);
  expect(await download.failure()).toBeNull();
  expect(artifactRequests.at(-1)).toMatchObject({ download: true });
});
