import { expect, test, type Page } from "@playwright/test";
import { establishDemoSession, submitPrompt } from "../helpers/playwright-auth";

const demoUserId = process.env.AIBRAIN_UI_INSTALLATION === "northwind-qa" ? "operations-user" : "example-user";
const projectId = "018f5f68-4a6e-7abc-8def-0123456789ab";
const documentId = "018f5f68-4a6e-7abc-8def-0123456789ae";
const browserId = "018f5f68-4a6e-7abc-8def-0123456789af";

function validPdf() {
  const header = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  const offsets: number[] = [];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  return `${header}${objects.join("")}xref\n0 4\n0000000000 65535 f \n${offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
}

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
  await page.route(`**/api/projects/${projectId}/artifacts/${documentId}/preview/1`, (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: validPdf() }));
  await page.route(`**/api/browser/sessions/${browserId}/viewer`, (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial;background:#f7f7f5;color:#252522"><header style="padding:14px 20px;background:#fff;border-bottom:1px solid #ddd">Sesión aislada · Datos sintéticos</header><main style="padding:28px"><h1 style="font-size:24px">Comprobación web</h1><p>El viewer solo muestra esta sesión temporal de prueba.</p><button style="padding:10px 14px">Elemento interactivo</button></main></body></html>' }));
  await establishDemoSession(page, demoUserId);
  await submitPrompt(page, "Prepara un PDF y una comprobación web sintéticos.");
  await expect(page.getByRole("heading", { name: "Archivos preparados" })).toBeVisible();
  await page.locator("nextjs-portal").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

test("document preview, publication state and browser viewer", async ({ page }) => {
  await openCapabilities(page);
  const document = page.getByRole("heading", { name: "informe-sintetico.pdf" });
  await document.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Revisar antes de descargar" }).click();
  await expect(page.getByRole("complementary", { name: "Vista previa de informe-sintetico.pdf" })).toBeVisible();
  await expect(page.getByTitle("Documento informe-sintetico.pdf")).toHaveAttribute("src", /^blob:/);
  await expect(page).toHaveScreenshot("document-preview.png", { fullPage: true });
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  const viewer = page.getByRole("button", { name: "Abrir", exact: true });
  await viewer.scrollIntoViewIfNeeded();
  await viewer.click();
  await expect(page.getByRole("complementary", { name: "Vista previa de informe-sintetico.pdf" })).toHaveCount(0);
  await expect(page.locator(`iframe[src*="/api/browser/sessions/${browserId}"]`)).toHaveCount(0);
  await expect(page).toHaveScreenshot("browser-viewer.png", { fullPage: true });
});

test("document preview and browser viewer dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openCapabilities(page);
  const document = page.getByRole("heading", { name: "informe-sintetico.pdf" });
  await document.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Revisar antes de descargar" }).click();
  await expect(page.getByRole("complementary", { name: "Vista previa de informe-sintetico.pdf" })).toBeVisible();
  await expect(page.getByTitle("Documento informe-sintetico.pdf")).toHaveAttribute("src", /^blob:/);
  await expect(page).toHaveScreenshot("document-preview-dark.png", { fullPage: true });
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  const viewer = page.getByRole("button", { name: "Abrir", exact: true });
  await viewer.scrollIntoViewIfNeeded();
  await viewer.click();
  await expect(page.getByRole("complementary", { name: "Vista previa de informe-sintetico.pdf" })).toHaveCount(0);
  await expect(page.locator(`iframe[src*="/api/browser/sessions/${browserId}"]`)).toHaveCount(0);
  await expect(page).toHaveScreenshot("browser-viewer-dark.png", { fullPage: true });
});
