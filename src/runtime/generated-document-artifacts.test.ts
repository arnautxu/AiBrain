import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatedDocumentArtifactsFromRuntimeItem } from "@/runtime/generated-document-artifacts";
import { generateLocalDocument } from "@/runtime/documents/local-document-generator";

vi.mock("server-only", () => ({}));

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

    const dataRoot = await mkdtemp(path.join(tmpdir(), "aibrain-document-data-"));
    roots.push(dataRoot);
    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      command: `pdfinfo '${path.join(workspace, "informes", "precios carne.pdf")}'`,
      aggregatedOutput: "Pages:          4\n",
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", {
      installation: { installationId: "document-test", paths: { dataRoot } as never },
      threadId: "00000000-0000-4000-8000-000000000013",
      storageOwnerId: "00000000-0000-4000-8000-000000000014",
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: "precios carne.pdf",
      kind: "pdf",
      pages: 4,
      status: "ready",
      previewUrl: expect.stringContaining("/api/threads/00000000-0000-4000-8000-000000000013/artifacts/"),
      url: expect.stringContaining("?download=1"),
    });
    expect(await readFile(path.join(dataRoot, "generated-document-artifacts", "00000000-0000-4000-8000-000000000014", artifacts[0]!.id, "precios carne.pdf"), "utf8"))
      .toBe("%PDF-1.7\nfixture");
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

    const dataRoot = await mkdtemp(path.join(tmpdir(), "aibrain-office-data-"));
    roots.push(dataRoot);
    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({ paths: [
          "documents/resultado.docx",
          "documents/resultado.pptx",
          "documents/resultado.xlsx",
        ] }),
      }],
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", {
      installation: { installationId: "document-test", paths: { dataRoot } as never },
      threadId: "00000000-0000-4000-8000-000000000013",
      storageOwnerId: "00000000-0000-4000-8000-000000000014",
    });

    expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual(["docx", "pptx", "xlsx"]);
    expect(artifacts.every((artifact) => artifact.previewUrl?.endsWith("?preview=1"))).toBe(true);
    expect(artifacts.every((artifact) => artifact.url.endsWith("?download=1"))).toBe(true);
  });
});
