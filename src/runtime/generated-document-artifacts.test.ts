import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatedDocumentArtifactsFromRuntimeItem } from "@/runtime/generated-document-artifacts";
import { generateLocalDocument } from "@/runtime/documents/local-document-generator";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generated document artifact projection", () => {
  it("turns a verified workspace PDF mentioned by a command into private preview and download URLs", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aibrain-document-artifact-"));
    roots.push(workspace);
    await mkdir(path.join(workspace, "informes"));
    await writeFile(path.join(workspace, "informes", "precios carne.pdf"), Buffer.from("%PDF-1.7\nfixture"));

    const register = vi.fn(async () => undefined);
    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      command: `pdfinfo '${path.join(workspace, "informes", "precios carne.pdf")}'`,
      aggregatedOutput: "Pages:          4\n",
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", {
      threadId: "00000000-0000-4000-8000-000000000013",
      storageOwnerId: "00000000-0000-4000-8000-000000000014",
      register,
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: "precios carne.pdf",
      kind: "pdf",
      pages: 4,
      status: "ready",
      previewUrl: expect.stringContaining("path=informes%2Fprecios%20carne.pdf&raw=1"),
      url: expect.stringContaining("&download=1"),
    });
    expect(artifacts[0]?.previewUrl).toContain(`resourceId=${artifacts[0]?.id}`);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: "workspace-file",
      resourceId: artifacts[0]?.id,
      projectId: "00000000-0000-4000-8000-000000000011",
      threadId: "00000000-0000-4000-8000-000000000013",
      messageId: "00000000-0000-4000-8000-000000000012",
      storageOwnerId: "00000000-0000-4000-8000-000000000014",
      relativePath: "informes/precios carne.pdf",
      mediaType: "application/pdf",
      size: Buffer.byteLength("%PDF-1.7\nfixture"),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("ignores paths outside the project and files that are not PDFs", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aibrain-document-boundary-"));
    const outside = await mkdtemp(path.join(tmpdir(), "aibrain-document-outside-"));
    roots.push(workspace, outside);
    const outsidePdf = path.join(outside, "private.pdf");
    await writeFile(outsidePdf, Buffer.from("%PDF-1.7\nprivate"));
    await writeFile(path.join(workspace, "fake.pdf"), Buffer.from("not a pdf"));

    await expect(generatedDocumentArtifactsFromRuntimeItem({
      command: `pdfinfo '${outsidePdf}' './fake.pdf'`,
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012")).resolves.toEqual([]);
  });

  it("projects verified DOCX, PPTX and XLSX results with private converted previews", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aibrain-office-artifacts-"));
    roots.push(workspace);
    await mkdir(path.join(workspace, "documents"));
    for (const format of ["docx", "pptx", "xlsx"] as const) {
      const generated = await generateLocalDocument({
        format,
        title: `Documento ${format}`,
        content: format === "xlsx" ? "Nombre\tValor\nPrueba\t1" : "Contenido real",
      });
      await writeFile(path.join(workspace, "documents", `resultado.${format}`), generated.data);
    }

    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({ paths: [
          "documents/resultado.docx",
          "documents/resultado.pptx",
          "documents/resultado.xlsx",
        ] }),
      }],
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012");

    expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual(["docx", "pptx", "xlsx"]);
    expect(artifacts.every((artifact) => artifact.previewUrl?.includes("representation=1"))).toBe(true);
    expect(artifacts.every((artifact) => artifact.url.includes("raw=1&download=1"))).toBe(true);
  });
});
