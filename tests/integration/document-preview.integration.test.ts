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
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.skipIf(!hasToolchain)("converts a real DOCX into a validated PDF and PNG preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-preview-"));
  roots.push(root);
  const sourceText = path.join(root, "source.txt");
  await writeFile(sourceText, "AiBrain document preview integration\n", "utf8");
  await run(tools.soffice, [
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
