import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { StagedDocument } from "@/documents/staging-store";
import { ensurePrivateDirectoryTree } from "@/documents/staging-store";
import { readRegularFileWithin } from "@/security/safe-file";
import { atomicWriteFile, atomicWriteJson, readValidatedJson } from "@/storage/atomic-file";
import { StorageError } from "@/storage/errors";
import type { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectArray,
  expectInteger,
  expectIsoDate,
  expectOneOf,
  expectString,
} from "@/storage/schema";

const execFileAsync = promisify(execFile);

export type DocumentPreview = {
  schemaVersion: 1;
  uploadId: string;
  threadId: string;
  sourceSha256: string;
  status: "ready";
  kind: StagedDocument["kind"];
  files: string[];
  pages: number | null;
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PREVIEW_METADATA_BYTES = 64 * 1024;

const previewSchema = defineVersionedSchema<DocumentPreview>({
  name: "DocumentPreview",
  schemaVersion: 1,
  keys: ["uploadId", "threadId", "sourceSha256", "status", "kind", "files", "pages", "createdAt"],
  parse(record, context) {
    return {
      schemaVersion: 1,
      uploadId: expectString(record.uploadId, context.at("uploadId"), { pattern: UUID }),
      threadId: expectString(record.threadId, context.at("threadId"), { pattern: UUID }),
      sourceSha256: expectString(record.sourceSha256, context.at("sourceSha256"), { pattern: SHA256 }),
      status: expectOneOf(record.status, ["ready"] as const, context.at("status")),
      kind: expectOneOf(record.kind, ["docx", "xlsx", "pptx", "pdf", "text", "image"] as const, context.at("kind")),
      files: expectArray(record.files, context.at("files"), (value, item) =>
        expectString(value, item, { minLength: 1, maxLength: 160, pattern: /^[a-z0-9][a-z0-9._-]*$/ }), { maxLength: 2 }),
      pages: record.pages === null ? null : expectInteger(record.pages, context.at("pages"), { minimum: 1, maximum: 500 }),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
    };
  },
});

export type ToolRunOptions = {
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
};

export interface DocumentToolRunner {
  run(command: string, args: readonly string[], options: ToolRunOptions): Promise<{ stdout: string; stderr: string }>;
}

export class SystemDocumentToolRunner implements DocumentToolRunner {
  async run(command: string, args: readonly string[], options: ToolRunOptions) {
    try {
      const result = await execFileAsync(command, [...args], {
        cwd: options.cwd,
        env: { NODE_ENV: process.env.NODE_ENV ?? "production", ...options.env },
        timeout: options.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      throw new StorageError("DOCUMENT_TOOL_FAILED", `Document tool failed with code ${code}.`);
    }
  }
}

export type DocumentToolchain = {
  soffice: string;
  pdfinfo: string;
  pdftoppm: string;
  qpdf?: string;
};

function validateToolPath(name: string, value: string | undefined, required: boolean) {
  if (!value) {
    if (required) throw new StorageError("DOCUMENT_TOOL_MISSING", `${name} is required.`);
    return undefined;
  }
  if (!path.isAbsolute(value)) throw new StorageError("DOCUMENT_TOOL_INVALID", `${name} must be an absolute path.`);
  return path.resolve(value);
}

function parsePdfInfo(output: string) {
  const encrypted = /^Encrypted:\s+yes/im.test(output);
  const pagesMatch = output.match(/^Pages:\s+(\d+)\s*$/im);
  const pages = pagesMatch ? Number(pagesMatch[1]) : NaN;
  if (encrypted) throw new StorageError("DOCUMENT_PDF_ENCRYPTED", "Encrypted PDFs are not accepted.");
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 500) {
    throw new StorageError("DOCUMENT_PDF_UNSAFE", "PDF page count is missing or exceeds the safety limit.");
  }
  return pages;
}

function outputExtension(document: StagedDocument) {
  if (document.kind === "image") return path.extname(document.fileName).toLowerCase().slice(1);
  return document.kind === "text" ? "txt" : "pdf";
}

export class DocumentPreviewService {
  readonly previewRoot: string;
  private readonly tools: Required<Omit<DocumentToolchain, "qpdf">> & { qpdf?: string };

  constructor(options: {
    stagingRoot: string;
    previewRoot: string;
    lockManager: ResourceLockManager;
    runner?: DocumentToolRunner;
    tools: DocumentToolchain;
    requireQpdf?: boolean;
    now?: () => number;
  }) {
    if (!path.isAbsolute(options.stagingRoot) || !path.isAbsolute(options.previewRoot)) {
      throw new StorageError("DOCUMENT_PREVIEW_OPTIONS_INVALID", "Staging and preview roots must be absolute.");
    }
    this.stagingRoot = path.resolve(options.stagingRoot);
    this.previewRoot = path.resolve(options.previewRoot);
    this.lockManager = options.lockManager;
    this.runner = options.runner ?? new SystemDocumentToolRunner();
    this.now = options.now ?? Date.now;
    this.tools = {
      soffice: validateToolPath("soffice", options.tools.soffice, true)!,
      pdfinfo: validateToolPath("pdfinfo", options.tools.pdfinfo, true)!,
      pdftoppm: validateToolPath("pdftoppm", options.tools.pdftoppm, true)!,
      qpdf: validateToolPath("qpdf", options.tools.qpdf, options.requireQpdf ?? process.env.NODE_ENV === "production"),
    };
  }

  private readonly stagingRoot: string;
  private readonly lockManager: ResourceLockManager;
  private readonly runner: DocumentToolRunner;
  private readonly now: () => number;

  private previewLocations(threadId: string, uploadId: string) {
    if (!UUID.test(threadId) || !UUID.test(uploadId)) {
      throw new StorageError("DOCUMENT_PREVIEW_ID_INVALID", "Preview thread and upload ids must be UUIDs.");
    }
    const relativeDirectory = path.posix.join(threadId, uploadId);
    return {
      relativeDirectory,
      directory: path.join(this.previewRoot, threadId, uploadId),
      metadataPath: path.join(this.previewRoot, threadId, uploadId, "preview.json"),
    };
  }

  private async readMetadata(metadataPath: string) {
    const metadata = await lstat(metadataPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1 ||
        metadata.size > MAX_PREVIEW_METADATA_BYTES || (metadata.mode & 0o077) !== 0) {
      throw new StorageError("DOCUMENT_PREVIEW_UNSAFE", "Preview metadata is not a private regular file.");
    }
    return readValidatedJson(metadataPath, previewSchema);
  }

  async create(document: StagedDocument) {
    const { directory, metadataPath } = this.previewLocations(document.threadId, document.uploadId);
    return this.lockManager.withLock(`document-preview:${metadataPath}`, async () => {
      try {
        const existing = await this.readMetadata(metadataPath);
        if (existing.sourceSha256 !== document.sha256) {
          throw new StorageError("DOCUMENT_PREVIEW_CONFLICT", "Preview id already belongs to different source content.");
        }
        return existing;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      }

      await ensurePrivateDirectoryTree(this.previewRoot, [document.threadId, document.uploadId]);
      const work = await mkdtemp(path.join(directory, ".work-"));
      try {
        const source = await readRegularFileWithin(this.stagingRoot, document.relativePath, 50 * 1024 * 1024);
        const inputPath = path.join(work, `input${path.extname(document.fileName).toLowerCase()}`);
        await atomicWriteFile(inputPath, source, { mode: 0o600 });
        const files: string[] = [];
        let pages: number | null = null;

        if (document.kind === "text" || document.kind === "image") {
          const name = `preview.${outputExtension(document)}`;
          await atomicWriteFile(path.join(directory, name), source, { mode: 0o600 });
          files.push(name);
        } else {
          let pdfPath = inputPath;
          const environment = {
            HOME: path.join(work, "home"),
            LANG: "C.UTF-8",
            LC_ALL: "C.UTF-8",
            SAL_USE_VCLPLUGIN: "svp",
          };
          await ensurePrivateDirectoryTree(work, ["home"]);
          if (document.kind !== "pdf") {
            await this.runner.run(this.tools.soffice, [
              `-env:UserInstallation=file://${path.join(work, "lo-profile")}`,
              "--headless", "--invisible", "--nologo", "--nodefault", "--nofirststartwizard",
              "--norestore", "--safe-mode", "--convert-to", "pdf", "--outdir", work, inputPath,
            ], { cwd: work, env: environment, timeoutMs: 60_000 });
            pdfPath = path.join(work, "input.pdf");
          }
          if (this.tools.qpdf) {
            await this.runner.run(this.tools.qpdf, ["--check", pdfPath], {
              cwd: work, env: environment, timeoutMs: 15_000,
            });
          }
          const info = await this.runner.run(this.tools.pdfinfo, [pdfPath], {
            cwd: work, env: environment, timeoutMs: 15_000,
          });
          pages = parsePdfInfo(info.stdout);
          await this.runner.run(this.tools.pdftoppm, [
            "-f", "1", "-singlefile", "-png", "-r", "120", pdfPath, path.join(work, "page-1"),
          ], { cwd: work, env: environment, timeoutMs: 30_000 });
          const pdf = await readFile(pdfPath);
          const image = await readFile(path.join(work, "page-1.png"));
          if (pdf.length > 100 * 1024 * 1024 || image.length > 20 * 1024 * 1024) {
            throw new StorageError("DOCUMENT_PREVIEW_TOO_LARGE", "Generated preview exceeds its safety limit.");
          }
          await atomicWriteFile(path.join(directory, "document.pdf"), pdf, { mode: 0o600 });
          await atomicWriteFile(path.join(directory, "page-1.png"), image, { mode: 0o600 });
          await Promise.all([
            chmod(path.join(directory, "document.pdf"), 0o600),
            chmod(path.join(directory, "page-1.png"), 0o600),
          ]);
          files.push("document.pdf", "page-1.png");
        }

        const preview: DocumentPreview = {
          schemaVersion: 1,
          uploadId: document.uploadId,
          threadId: document.threadId,
          sourceSha256: document.sha256,
          status: "ready",
          kind: document.kind,
          files,
          pages,
          createdAt: new Date(this.now()).toISOString(),
        };
        await atomicWriteJson(metadataPath, preview, previewSchema);
        return preview;
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  }

  async read(threadId: string, uploadId: string) {
    const locations = this.previewLocations(threadId, uploadId);
    const preview = await this.readMetadata(locations.metadataPath);
    if (preview.threadId !== threadId || preview.uploadId !== uploadId) {
      throw new StorageError("DOCUMENT_PREVIEW_MISMATCH", "Preview identity does not match its path.");
    }
    return preview;
  }

  async readFile(threadId: string, uploadId: string, fileName: string) {
    const preview = await this.read(threadId, uploadId);
    if (!preview.files.includes(fileName)) {
      throw new StorageError("DOCUMENT_PREVIEW_FILE_NOT_FOUND", "Preview file was not found.");
    }
    return readRegularFileWithin(
      this.previewRoot,
      path.posix.join(threadId, uploadId, fileName),
      100 * 1024 * 1024,
    );
  }
}
