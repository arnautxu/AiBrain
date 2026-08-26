import { expect, test, type Page } from "@playwright/test";

const accountName = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "Taylor" : "Alex";
const projectId = "018f5f68-4a6e-7abc-8def-0123456789ab";
const documentId = "018f5f68-4a6e-7abc-8def-0123456789ae";
const browserId = "018f5f68-4a6e-7abc-8def-0123456789af";

async function openCapabilities(page: Page) {
  const document = {
    id: documentId, type: "document", name: "informe-sintetico.pdf",
    url: `/api/projects/${projectId}/artifacts/${documentId}`, kind: "pdf",
    mimeType: "application/pdf", size: 42_000, status: "ready", pages: 2,
    previewUrl: `/api/projects/${projectId}/artifacts/${documentId}/preview/1`,
    publicationStatus: "awaiting_confirmation", publicationError: null, targetLabel: "Informes/informe-sintetico.pdf", error: null,
  };
  const browser = { id: browserId, type: "browser", name: "Comprobación web sintética", status: "active", control: "agent", viewerUrl: `/api/browser/sessions/${browserId}/viewer`, captureUrl: null, downloadUrl: `/api/browser/sessions/${browserId}/download`, error: null };
  const events = [
    { type: "artifact", item: document },
    { type: "artifact", item: browser },
    { type: "delta", value: "## Archivos preparados\n\nRevisa las vistas previas antes de continuar." },
    { type: "done" },
  ];
  await page.route("**/api/chat", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "application/x-ndjson" }, body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` }));
  await page.route(`**/api/projects/${projectId}/artifacts/${documentId}/preview/1`, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#fff"/><rect x="60" y="55" width="840" height="430" rx="18" fill="#f4f4f1" stroke="#d8d7d2"/><text x="105" y="145" font-family="Arial" font-size="34" font-weight="700" fill="#252522">Informe sintético</text><text x="105" y="205" font-family="Arial" font-size="20" fill="#64615c">Vista previa segura · Página 1 de 2</text><rect x="105" y="260" width="570" height="16" rx="8" fill="#d8d7d2"/><rect x="105" y="300" width="690" height="16" rx="8" fill="#e2e1dd"/><rect x="105" y="340" width="480" height="16" rx="8" fill="#e2e1dd"/></svg>' }));
  await page.route(`**/api/browser/sessions/${browserId}/viewer`, (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial;background:#f7f7f5;color:#252522"><header style="padding:14px 20px;background:#fff;border-bottom:1px solid #ddd">Sesión aislada · Datos sintéticos</header><main style="padding:28px"><h1 style="font-size:24px">Comprobación web</h1><p>El viewer solo muestra esta sesión temporal de prueba.</p><button style="padding:10px 14px">Elemento interactivo</button></main></body></html>' }));
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(accountName) }).click();
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Prepara un PDF y una comprobación web sintéticos.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByRole("heading", { name: "Archivos preparados" })).toBeVisible();
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test("document preview, publication state and browser viewer", async ({ page }) => {
  await openCapabilities(page);
  const document = page.getByRole("heading", { name: "informe-sintetico.pdf" });
  await document.scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "Vista previa de informe-sintetico.pdf" })).toBeVisible();
  await expect(page).toHaveScreenshot("document-preview.png", { fullPage: true });
  const viewer = page.getByTitle("Sesión de navegador: Comprobación web sintética");
  await viewer.scrollIntoViewIfNeeded();
  await expect(page.frameLocator('iframe[title="Sesión de navegador: Comprobación web sintética"]').getByText("Comprobación web")).toBeVisible();
  await expect(page).toHaveScreenshot("browser-viewer.png", { fullPage: true });
});
