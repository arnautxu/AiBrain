import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentPreviewService, type DocumentToolRunner } from "@/documents/preview-service";
import { FileDocumentStagingStore } from "@/documents/staging-store";
import { validateUploadedDocument } from "@/documents/upload-validation";
import { ResourceLockManager } from "@/storage/resource-lock";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";

class FakeRunner implements DocumentToolRunner {
  calls: Array<{ command: string; args: readonly string[] }> = [];
  async run(command: string, args: readonly string[]) {
    this.calls.push({ command, args });
    return { stdout: "Pages:          2\nEncrypted:      no\n", stderr: "" };
  }
}

describe("document preview service", () => {
  let root: string;
  let stagingRoot: string;
  let previewRoot: string;
  let locks: ResourceLockManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aibrain-preview-"));
    stagingRoot = path.join(root, "staging");
    previewRoot = path.join(root, "previews");
    locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates an idempotent text preview without invoking external tools", async () => {
    const data = Buffer.from("safe text");
    const staged = await new FileDocumentStagingStore(stagingRoot, locks).stage({
      threadId: THREAD_ID,
      uploadId: UPLOAD_ID,
      data,
      validated: validateUploadedDocument({ fileName: "notes.txt", declaredMimeType: "text/plain", data }),
    });
    const runner = new FakeRunner();
    const service = new DocumentPreviewService({
      stagingRoot,
      previewRoot,
      lockManager: locks,
      runner,
      tools: { soffice: "/tools/soffice", pdfinfo: "/tools/pdfinfo", pdftoppm: "/tools/pdftoppm" },
      requireQpdf: false,
      now: () => 1_000,
    });

    const first = await service.create(staged);
    const second = await service.create(staged);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ files: ["preview.txt"], pages: null, status: "ready" });
    expect(runner.calls).toHaveLength(0);
    expect(await readFile(path.join(previewRoot, THREAD_ID, UPLOAD_ID, "preview.txt"), "utf8")).toBe("safe text");
  });

  it("fails closed when production requires qpdf but none is configured", () => {
    expect(() => new DocumentPreviewService({
      stagingRoot,
      previewRoot,
      lockManager: locks,
      runner: new FakeRunner(),
      tools: { soffice: "/tools/soffice", pdfinfo: "/tools/pdfinfo", pdftoppm: "/tools/pdftoppm" },
      requireQpdf: true,
    })).toThrowError(expect.objectContaining({ code: "DOCUMENT_TOOL_MISSING" }));
  });
});
