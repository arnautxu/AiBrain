import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  it("keeps presentation drafts private even when shell output mentions them, then captures the final", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aibrain-presentation-drafts-"));
    const dataRoot = await mkdtemp(path.join(tmpdir(), "aibrain-presentation-final-"));
    roots.push(workspace, dataRoot);
    await mkdir(path.join(workspace, ".aibrain-drafts", "rendered"), { recursive: true });
    await mkdir(path.join(workspace, "documents"));
    const draftPptx = await generateLocalDocument({
      format: "pptx", title: "Quarterly review", content: "Quarterly review",
      slides: [{ title: "Results", body: "Revenue grew by 12%." }, { title: "Next quarter", body: "Expand the pilot to two teams." }],
    });
    const draftPdf = await generateLocalDocument({ format: "pdf", title: "Preview", content: "Internal preview for layout verification." });
    await writeFile(path.join(workspace, ".aibrain-drafts", "review.pptx"), draftPptx.data);
    await writeFile(path.join(workspace, ".aibrain-drafts", "rendered", "review.pdf"), draftPdf.data);
    const persistence = {
      installation: { installationId: "document-test", paths: { dataRoot } as never },
      threadId: "00000000-0000-4000-8000-000000000013",
      storageOwnerId: "00000000-0000-4000-8000-000000000014",
    };
    const projectId = "00000000-0000-4000-8000-000000000011";
    const turnId = "00000000-0000-4000-8000-000000000012";
    await expect(generatedDocumentArtifactsFromRuntimeItem({
      command: "render '.aibrain-drafts/review.pptx'",
      aggregatedOutput: `Rendered "${path.join(workspace, ".aibrain-drafts", "rendered", "review.pdf")}"`,
      text: 'Preview "documents/../.aibrain-drafts/review.pptx"',
      changes: [{ path: ".aibrain-drafts/review.pptx" }],
    }, workspace, projectId, turnId, persistence)).resolves.toEqual([]);
    expect(await readdir(dataRoot)).toEqual([]);

    await writeFile(path.join(workspace, "documents", "review.pptx"), draftPptx.data);
    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      aggregatedOutput: 'Copied "./.aibrain-drafts/review.pptx" to "./documents/review.pptx"',
    }, workspace, projectId, turnId, persistence);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ name: "review.pptx", kind: "pptx", status: "ready" });
    expect(await readFile(path.join(dataRoot, "generated-document-artifacts", persistence.storageOwnerId, artifacts[0]!.id, "review.pptx")))
      .toEqual(draftPptx.data);
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
