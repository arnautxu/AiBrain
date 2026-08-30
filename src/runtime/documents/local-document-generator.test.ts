import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateUploadedDocument } from "@/documents/upload-validation";
import { generateLocalDocument } from "@/runtime/documents/local-document-generator";

describe("local document generator", () => {
  it.each([
    ["pdf", "Informe local", "Resumen\nContenido comprobable"],
    ["docx", "Documento local", "# Resumen\nContenido comprobable"],
    ["pptx", "Presentación local", "Primera diapositiva\n- Punto uno\n---\nSegunda diapositiva\n- Punto dos"],
    ["xlsx", "Datos locales", "Nombre\tImporte\nServicio\t1250"],
  ] as const)("creates a non-empty, validated %s", async (format, title, content) => {
    const generated = await generateLocalDocument({ format, title, content });

    expect(generated.data.length).toBeGreaterThan(100);
    expect(generated.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(validateUploadedDocument({
      fileName: `resultado.${format}`,
      declaredMimeType: generated.mimeType,
      data: generated.data,
    })).toMatchObject({ kind: format, size: generated.data.length, sha256: generated.sha256 });
  });

  it("preserves real content in each Office package", async () => {
    const docx = await generateLocalDocument({ format: "docx", title: "Informe Arnall", content: "Margen verificado" });
    const xlsx = await generateLocalDocument({
      format: "xlsx",
      title: "Ventas Arnall",
      content: "Tabla de ventas",
      rows: [["Producto", "Importe"], ["Servicio", 1250]],
    });
    const pptx = await generateLocalDocument({ format: "pptx", title: "Propuesta Arnall", content: "Objetivo\nImpacto medible" });
    const [docxZip, xlsxZip, pptxZip] = await Promise.all([
      JSZip.loadAsync(docx.data),
      JSZip.loadAsync(xlsx.data),
      JSZip.loadAsync(pptx.data),
    ]);

    await expect(docxZip.file("word/document.xml")!.async("text")).resolves.toContain("Margen verificado");
    await expect(xlsxZip.file("xl/worksheets/sheet1.xml")!.async("text")).resolves.toContain("1250");
    await expect(pptxZip.file("ppt/slides/slide1.xml")!.async("text")).resolves.toContain("Impacto medible");
  });

  it("rejects empty output requests and malformed spreadsheet data", async () => {
    await expect(generateLocalDocument({ format: "pdf", title: "Informe", content: "" })).rejects.toMatchObject({
      code: "LOCAL_DOCUMENT_INPUT_INVALID",
    });
    await expect(generateLocalDocument({
      format: "xlsx",
      title: "Informe",
      content: "Datos",
      rows: [[Number.NaN]],
    })).rejects.toMatchObject({ code: "LOCAL_DOCUMENT_ROWS_INVALID" });
  });
});
