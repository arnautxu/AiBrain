import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { DocumentPreviewService } from "@/documents/preview-service";
import { FileDocumentStagingStore } from "@/documents/staging-store";
import { validateUploadedDocument } from "@/documents/upload-validation";
import { ResourceLockManager } from "@/storage/resource-lock";

const run = promisify(execFile);
const tools = {
  soffice: "/opt/homebrew/bin/soffice",
  pdfinfo: "/opt/homebrew/bin/pdfinfo",
  pdftoppm: "/opt/homebrew/bin/pdftoppm",
};
const hasToolchain = Object.values(tools).every(existsSync);
const runFullMatrix = hasToolchain && process.env.AIBRAIN_REAL_DOCUMENT_MATRIX === "1";
const roots: string[] = [];

function isolatedLibreOfficeProfile(root: string, name: string): string {
  return `-env:UserInstallation=file://${path.join(root, name)}`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.skipIf(!hasToolchain)("converts a real DOCX into a validated PDF and PNG preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-preview-"));
  roots.push(root);
  const sourceText = path.join(root, "source.txt");
  await writeFile(sourceText, "AiBrain document preview integration\n", "utf8");
  await run(tools.soffice, [
    isolatedLibreOfficeProfile(root, "lo-profile-docx-fixture"),
    "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore",
    "--convert-to", "docx", "--outdir", root, sourceText,
  ], { timeout: 30_000 });
  const data = await readFile(path.join(root, "source.docx"));
  const validated = validateUploadedDocument({
    fileName: "source.docx",
    declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    data,
  });
  const locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
  const stagingRoot = path.join(root, "staging");
  const staged = await new FileDocumentStagingStore(stagingRoot, locks).stage({
    threadId: "11111111-1111-4111-8111-111111111111",
    uploadId: "22222222-2222-4222-8222-222222222222",
    validated,
    data,
  });
  const preview = await new DocumentPreviewService({
    stagingRoot,
    previewRoot: path.join(root, "previews"),
    lockManager: locks,
    tools,
    requireQpdf: false,
  }).create(staged);

  expect(preview).toMatchObject({ kind: "docx", status: "ready", pages: 1 });
  expect(preview.files).toEqual(["document.pdf", "page-1.png"]);
  const previewDirectory = path.join(root, "previews", staged.threadId, staged.uploadId);
  expect((await readFile(path.join(previewDirectory, "document.pdf"))).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect((await readFile(path.join(previewDirectory, "page-1.png"))).subarray(0, 8))
    .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}, 90_000);

it.skipIf(!runFullMatrix)("previews XLSX, PPTX, PDF, UTF-8 text and image with the real toolchain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-preview-matrix-"));
  roots.push(root);
  const csvPath = path.join(root, "matrix.csv");
  const textPath = path.join(root, "notes.txt");
  const pptxPath = path.join(root, "slides.pptx");
  await Promise.all([
    writeFile(csvPath, "Name,Value\nAlpha,42\n", "utf8"),
    writeFile(textPath, "AiBrain text preview\n", "utf8"),
  ]);
  await run(tools.soffice, [
    isolatedLibreOfficeProfile(root, "lo-profile-xlsx-fixture"),
    "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore",
    "--convert-to", "xlsx", "--outdir", root, csvPath,
  ], { timeout: 30_000 });
  await run(tools.soffice, [
    isolatedLibreOfficeProfile(root, "lo-profile-pdf-fixture"),
    "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore",
    "--convert-to", "pdf", "--outdir", root, textPath,
  ], { timeout: 30_000 });
  await run("/usr/bin/python3", [
    "-c",
    [
      "from pptx import Presentation",
      "import sys",
      "deck=Presentation()",
      "slide=deck.slides.add_slide(deck.slide_layouts[1])",
      "slide.shapes.title.text='AiBrain preview'",
      "slide.placeholders[1].text='Isolated presentation'",
      "deck.save(sys.argv[1])",
    ].join(";"),
    pptxPath,
  ], { timeout: 30_000 });

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const fixtures = [
    {
      uploadId: "22222222-2222-4222-8222-222222222223",
      fileName: "matrix.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: await readFile(path.join(root, "matrix.xlsx")),
      expected: ["document.pdf", "page-1.png"],
    },
    {
      uploadId: "22222222-2222-4222-8222-222222222224",
      fileName: "slides.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: await readFile(pptxPath),
      expected: ["document.pdf", "page-1.png"],
    },
    {
      uploadId: "22222222-2222-4222-8222-222222222225",
      fileName: "notes.pdf",
      mime: "application/pdf",
      data: await readFile(path.join(root, "notes.pdf")),
      expected: ["document.pdf", "page-1.png"],
    },
    {
      uploadId: "22222222-2222-4222-8222-222222222226",
      fileName: "notes.txt",
      mime: "text/plain",
      data: await readFile(textPath),
      expected: ["preview.txt"],
    },
    {
      uploadId: "22222222-2222-4222-8222-222222222227",
      fileName: "pixel.png",
      mime: "image/png",
      data: png,
      expected: ["preview.png"],
    },
  ];
  const locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
  const stagingRoot = path.join(root, "staging");
  const previewRoot = path.join(root, "previews");
  const staging = new FileDocumentStagingStore(stagingRoot, locks);
  const service = new DocumentPreviewService({
    stagingRoot,
    previewRoot,
    lockManager: locks,
    tools,
    requireQpdf: false,
  });

  for (const fixture of fixtures) {
    const staged = await staging.stage({
      threadId: "11111111-1111-4111-8111-111111111111",
      uploadId: fixture.uploadId,
      data: fixture.data,
      validated: validateUploadedDocument({
        fileName: fixture.fileName,
        declaredMimeType: fixture.mime,
        data: fixture.data,
      }),
    });
    const preview = await service.create(staged);
    expect(preview.files).toEqual(fixture.expected);
    for (const fileName of preview.files) {
      expect((await service.readFile(staged.threadId, staged.uploadId, fileName)).byteLength).toBeGreaterThan(0);
    }
  }
}, 120_000);
