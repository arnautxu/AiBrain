import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatedDocumentArtifactsFromRuntimeItem } from "@/runtime/generated-document-artifacts";

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

    const artifacts = await generatedDocumentArtifactsFromRuntimeItem({
      command: `pdfinfo '${path.join(workspace, "informes", "precios carne.pdf")}'`,
      aggregatedOutput: "Pages:          4\n",
    }, workspace, "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012");

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: "precios carne.pdf",
      kind: "pdf",
      pages: 4,
      status: "ready",
      previewUrl: expect.stringContaining("path=informes%2Fprecios%20carne.pdf&raw=1"),
      url: expect.stringContaining("&download=1"),
    });
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
});
