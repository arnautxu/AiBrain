import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ValidatedUpload } from "@/documents/upload-validation";
import { atomicWriteFile, atomicWriteJson, readValidatedJson } from "@/storage/atomic-file";
import { StorageError } from "@/storage/errors";
import type { ResourceLockManager } from "@/storage/resource-lock";
import {
  defineVersionedSchema,
  expectInteger,
  expectIsoDate,
  expectOneOf,
  expectString,
} from "@/storage/schema";

export type StagedDocument = {
  schemaVersion: 1;
  uploadId: string;
  threadId: string;
  fileName: string;
  relativePath: string;
  kind: ValidatedUpload["kind"];
  mediaType: string;
  size: number;
  sha256: string;
  status: "staged";
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const stagedDocumentSchema = defineVersionedSchema<StagedDocument>({
  name: "StagedDocument",
  schemaVersion: 1,
  keys: [
    "uploadId", "threadId", "fileName", "relativePath", "kind", "mediaType",
    "size", "sha256", "status", "createdAt",
  ],
  parse(record, context) {
    return {
      schemaVersion: 1,
      uploadId: expectString(record.uploadId, context.at("uploadId"), { pattern: UUID }),
      threadId: expectString(record.threadId, context.at("threadId"), { pattern: UUID }),
      fileName: expectString(record.fileName, context.at("fileName"), { minLength: 1, maxLength: 120 }),
      relativePath: expectString(record.relativePath, context.at("relativePath"), {
        minLength: 1,
        maxLength: 500,
        pattern: /^threads\/[0-9a-f-]+\/uploads\/[0-9a-f-]+\/[^/\\]+$/i,
      }),
      kind: expectOneOf(record.kind, ["docx", "xlsx", "pptx", "pdf", "text", "image"] as const, context.at("kind")),
      mediaType: expectString(record.mediaType, context.at("mediaType"), { minLength: 1, maxLength: 180 }),
      size: expectInteger(record.size, context.at("size"), { minimum: 1, maximum: 50 * 1024 * 1024 }),
      sha256: expectString(record.sha256, context.at("sha256"), { pattern: SHA256 }),
      status: expectOneOf(record.status, ["staged"] as const, context.at("status")),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
    };
  },
});

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export async function ensurePrivateDirectoryTree(root: string, segments: readonly string[]) {
  const assertDirectory = async (directory: string) => {
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new StorageError("STORAGE_SYMLINK_REJECTED", `Unsafe staging directory ${directory}.`);
    }
  };
  let current = root;
  await mkdir(current, { recursive: true, mode: 0o700 });
  await assertDirectory(current);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await assertDirectory(current);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isNodeError(mkdirError, "EEXIST")) throw mkdirError;
      }
      await assertDirectory(current);
    }
  }
  return current;
}

export class FileDocumentStagingStore {
  readonly rootDirectory: string;

  constructor(
    rootDirectory: string,
    private readonly lockManager: ResourceLockManager,
    private readonly now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(rootDirectory) || rootDirectory === path.parse(rootDirectory).root) {
      throw new StorageError("STORAGE_STAGING_OPTIONS_INVALID", "Staging root must be a non-root absolute path.");
    }
    this.rootDirectory = path.resolve(rootDirectory);
  }

  private paths(threadId: string, uploadId: string, fileName: string) {
    if (!UUID.test(threadId) || !UUID.test(uploadId)) {
      throw new StorageError("STORAGE_STAGING_ID_INVALID", "Thread and upload ids must be UUIDs.");
    }
    const relativeDirectory = path.posix.join("threads", threadId, "uploads", uploadId);
    return {
      relativeDirectory,
      relativePath: path.posix.join(relativeDirectory, fileName),
      directory: path.join(this.rootDirectory, "threads", threadId, "uploads", uploadId),
      metadataPath: path.join(this.rootDirectory, "threads", threadId, "uploads", uploadId, "upload.json"),
      contentPath: path.join(this.rootDirectory, "threads", threadId, "uploads", uploadId, fileName),
    };
  }

  async stage(input: {
    threadId: string;
    uploadId: string;
    validated: ValidatedUpload;
    data: Buffer;
  }) {
    const actualHash = createHash("sha256").update(input.data).digest("hex");
    if (input.data.length !== input.validated.size || actualHash !== input.validated.sha256) {
      throw new StorageError("STORAGE_STAGING_CONTENT_MISMATCH", "Validated upload size changed before staging.");
    }
    const locations = this.paths(input.threadId, input.uploadId, input.validated.fileName);
    return this.lockManager.withLock(`document-upload:${locations.metadataPath}`, async () => {
      try {
        const existing = await readValidatedJson(locations.metadataPath, stagedDocumentSchema);
        if (existing.sha256 !== input.validated.sha256 || existing.fileName !== input.validated.fileName) {
          throw new StorageError("STORAGE_STAGING_ID_CONFLICT", "Upload id already identifies different content.");
        }
        return existing;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }

      await ensurePrivateDirectoryTree(this.rootDirectory, [
        "threads", input.threadId, "uploads", input.uploadId,
      ]);
      await atomicWriteFile(locations.contentPath, input.data, { mode: 0o600 });
      const metadata: StagedDocument = {
        schemaVersion: 1,
        uploadId: input.uploadId,
        threadId: input.threadId,
        fileName: input.validated.fileName,
        relativePath: locations.relativePath,
        kind: input.validated.kind,
        mediaType: input.validated.mediaType,
        size: input.validated.size,
        sha256: input.validated.sha256,
        status: "staged",
        createdAt: new Date(this.now()).toISOString(),
      };
      await atomicWriteJson(locations.metadataPath, metadata, stagedDocumentSchema);
      return metadata;
    });
  }

  async read(threadId: string, uploadId: string, fileName: string) {
    const locations = this.paths(threadId, uploadId, fileName);
    const metadata = await readValidatedJson(locations.metadataPath, stagedDocumentSchema);
    if (metadata.threadId !== threadId || metadata.uploadId !== uploadId || metadata.fileName !== fileName) {
      throw new StorageError("STORAGE_STAGING_METADATA_MISMATCH", "Staged document identity does not match its path.");
    }
    return metadata;
  }
}
