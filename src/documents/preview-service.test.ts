import { mkdtemp, readFile, readdir, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DocumentPreviewService,
  SystemDocumentToolRunner,
  type DocumentToolRunner,
} from "@/documents/preview-service";
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

async function eventually<T>(read: () => Promise<T>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    throw error;
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
    expect(first).toMatchObject({
      schemaVersion: 2,
      files: ["preview.txt"],
      artifacts: [{ fileName: "preview.txt", size: data.length, sha256: staged.sha256 }],
      pages: null,
      status: "ready",
    });
    expect(runner.calls).toHaveLength(0);
    expect(await readFile(path.join(previewRoot, THREAD_ID, UPLOAD_ID, "preview.txt"), "utf8")).toBe("safe text");
    expect((await service.read(THREAD_ID, UPLOAD_ID)).sourceSha256).toBe(staged.sha256);
    expect((await service.readFile(THREAD_ID, UPLOAD_ID, "preview.txt")).toString("utf8")).toBe("safe text");
    await expect(service.readFile(THREAD_ID, UPLOAD_ID, "not-listed.txt"))
      .rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_FILE_NOT_FOUND" });

    const previewPath = path.join(previewRoot, THREAD_ID, UPLOAD_ID, "preview.txt");
    const outside = path.join(root, "outside-preview.txt");
    await writeFile(outside, "outside", { mode: 0o600 });
    await unlink(previewPath);
    await symlink(outside, previewPath);
    await expect(service.readFile(THREAD_ID, UPLOAD_ID, "preview.txt"))
      .rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_INTEGRITY_FAILED" });
    await expect(service.create(staged)).rejects.toMatchObject({ code: "STORAGE_SYMLINK_REJECTED" });
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  it("rebuilds legacy metadata and an altered ready artifact from the staged source", async () => {
    const data = Buffer.from("attested source");
    const staged = await new FileDocumentStagingStore(stagingRoot, locks).stage({
      threadId: THREAD_ID,
      uploadId: UPLOAD_ID,
      data,
      validated: validateUploadedDocument({ fileName: "notes.txt", declaredMimeType: "text/plain", data }),
    });
    const service = new DocumentPreviewService({
      stagingRoot,
      previewRoot,
      lockManager: locks,
      runner: new FakeRunner(),
      tools: { soffice: "/tools/soffice", pdfinfo: "/tools/pdfinfo", pdftoppm: "/tools/pdftoppm" },
      requireQpdf: false,
    });
    const created = await service.create(staged);
    const directory = path.join(previewRoot, THREAD_ID, UPLOAD_ID);
    const metadataPath = path.join(directory, "preview.json");
    await writeFile(path.join(directory, "preview.txt"), "altered", { mode: 0o600 });
    await expect(service.read(THREAD_ID, UPLOAD_ID))
      .rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_INTEGRITY_FAILED" });
    const repaired = await service.create(staged);
    expect(repaired.artifacts).toEqual(created.artifacts);
    expect(await readFile(path.join(directory, "preview.txt"), "utf8")).toBe("attested source");

    await unlink(path.join(directory, "preview.txt"));
    await expect(service.read(THREAD_ID, UPLOAD_ID))
      .rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_INTEGRITY_FAILED" });
    await expect(service.create(staged)).resolves.toMatchObject({ artifacts: created.artifacts });

    const legacy = { ...repaired } as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.artifacts;
    await writeFile(metadataPath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    await expect(service.read(THREAD_ID, UPLOAD_ID))
      .rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_REBUILD_REQUIRED" });
    await expect(service.create(staged)).resolves.toMatchObject({ schemaVersion: 2 });
  });

  it("rejects a sparse oversized converter output before loading it into memory", async () => {
    const data = Buffer.from("%PDF-1.7\n%%EOF\n");
    const staged = await new FileDocumentStagingStore(stagingRoot, locks).stage({
      threadId: THREAD_ID,
      uploadId: UPLOAD_ID,
      data,
      validated: validateUploadedDocument({ fileName: "report.pdf", declaredMimeType: "application/pdf", data }),
    });
    const runner: DocumentToolRunner = {
      async run(command, args) {
        if (command.endsWith("pdfinfo")) return { stdout: "Pages: 1\nEncrypted: no\n", stderr: "" };
        if (command.endsWith("pdftoppm")) {
          const outputPrefix = args.at(-1)!;
          await writeFile(`${outputPrefix}.png`, "x", { mode: 0o600 });
          await truncate(`${outputPrefix}.png`, 20 * 1024 * 1024 + 1);
        }
        return { stdout: "", stderr: "" };
      },
    };
    const service = new DocumentPreviewService({
      stagingRoot,
      previewRoot,
      lockManager: locks,
      runner,
      tools: { soffice: "/tools/soffice", pdfinfo: "/tools/pdfinfo", pdftoppm: "/tools/pdftoppm" },
      requireQpdf: false,
    });
    await expect(service.create(staged)).rejects.toMatchObject({ code: "DOCUMENT_PREVIEW_TOO_LARGE" });
    expect((await readdir(path.join(previewRoot, THREAD_ID, UPLOAD_ID)))
      .filter((entry) => entry.startsWith(".work-"))).toEqual([]);
  });

  it.each([
    { reason: "request cancellation", expectedCode: "DOCUMENT_OPERATION_ABORTED", abort: true },
    { reason: "conversion timeout", expectedCode: "DOCUMENT_TOOL_TIMEOUT", abort: false },
  ])("kills the complete converter process group after $reason", async ({ expectedCode, abort }) => {
    const pidFile = path.join(root, `converter-child-${abort ? "abort" : "timeout"}.pid`);
    const childProgram = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const parentProgram = [
      "const {spawn}=require('node:child_process')",
      "const {writeFileSync}=require('node:fs')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{stdio:'ignore'})`,
      "writeFileSync(process.argv[1],String(child.pid))",
      "process.on('SIGTERM',()=>{})",
      "setInterval(()=>{},1000)",
    ].join(";");
    const controller = new AbortController();
    const runner = new SystemDocumentToolRunner();
    const startedAt = Date.now();
    const running = runner.run(process.execPath, ["-e", parentProgram, pidFile], {
      cwd: root,
      env: {},
      timeoutMs: abort ? 5_000 : 250,
      signal: controller.signal,
    });
    const childPid = Number(await eventually(async () => await readFile(pidFile, "utf8")));
    expect(processIsAlive(childPid)).toBe(true);
    if (abort) controller.abort();
    await expect(running).rejects.toMatchObject({ code: expectedCode });
    await eventually(async () => {
      if (processIsAlive(childPid)) throw new Error("converter child is still alive");
      return true;
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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
