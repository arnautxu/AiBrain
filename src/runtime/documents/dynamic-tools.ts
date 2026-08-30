import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolCallParams } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import type { DocumentArtifact } from "@/lib/chat-contract";
import type { ResolvedPermissions } from "@/permissions";
import { validateUploadedDocument } from "@/documents/upload-validation";
import { readRegularFileWithin } from "@/security/safe-file";
import { atomicWriteFile } from "@/storage";
import {
  generateLocalDocument,
  type LocalDocumentCell,
  type LocalDocumentFormat,
} from "@/runtime/documents/local-document-generator";

export const AIBRAIN_DOCUMENT_TOOL_NAMESPACE = "aibrain_documents";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FILE_NAME_PATTERN = /^[^/\\\0\r\n]{1,160}$/u;
const FORMATS = ["pdf", "docx", "pptx", "xlsx"] as const;

export const DOCUMENT_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
  description: "Create validated PDF, Word, PowerPoint and Excel files in this employee's private AiBrain project workspace on the installation server. This is the default document destination. It does not use Google Drive or any external connector.",
  tools: [{
    type: "function",
    name: "create",
    description: "Create one non-empty local document, verify its format and return its private preview/download artifact. Use rows for structured Excel data; content is still required as a human-readable description or fallback table.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["pdf", "docx", "pptx", "xlsx"] },
        fileName: { type: "string", minLength: 1, maxLength: 160 },
        title: { type: "string", minLength: 1, maxLength: 500 },
        content: { type: "string", minLength: 1, maxLength: 200_000 },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 2_000,
          items: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { type: ["string", "number", "boolean", "null"] },
          },
        },
      },
      required: ["format", "fileName", "title", "content"],
      additionalProperties: false,
    },
  }],
}]);

export class LocalDocumentDynamicToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LocalDocumentDynamicToolError";
  }
}

type CreateArguments = Readonly<{
  format: LocalDocumentFormat;
  fileName: string;
  title: string;
  content: string;
  rows?: readonly (readonly LocalDocumentCell[])[];
}>;

type Receipt = Readonly<{
  schemaVersion: 1;
  installationId: string;
  userId: string;
  projectId: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
  callId: string;
  inputFingerprint: string;
  relativePath: string;
  format: LocalDocumentFormat;
  mimeType: string;
  size: number;
  sha256: string;
  pages: number | null;
  createdAt: string;
}>;

export type LocalDocumentDynamicToolResult = Readonly<{
  response: DynamicToolCallResponse;
  artifact: DocumentArtifact | null;
}>;

export type LocalDocumentDynamicToolContext = Readonly<{
  installationId: string;
  userId: string;
  projectId: string;
  projectWorkspace: string;
  receiptRoot: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
  permissions: ResolvedPermissions;
  now?: () => Date;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const keys = Object.keys(value);
  if (required.some((key) => !(key in value)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Document tool fields are invalid.");
  }
}

function parseRows(value: unknown): readonly (readonly LocalDocumentCell[])[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 2_000) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Spreadsheet rows are invalid.");
  }
  return value.map((row) => {
    if (!Array.isArray(row) || row.length === 0 || row.length > 100) {
      throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Spreadsheet row width is invalid.");
    }
    return row.map((cell) => {
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") {
        throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Spreadsheet cell is invalid.");
      }
      return cell as LocalDocumentCell;
    });
  });
}

function parseArguments(value: unknown): CreateArguments {
  if (!isRecord(value)) throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Document arguments must be an object.");
  exactKeys(value, ["format", "fileName", "title", "content"], ["rows"]);
  if (typeof value.format !== "string" || !FORMATS.includes(value.format as LocalDocumentFormat) ||
      typeof value.fileName !== "string" || !FILE_NAME_PATTERN.test(value.fileName) || value.fileName === "." || value.fileName === ".." ||
      typeof value.title !== "string" || typeof value.content !== "string") {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_ARGUMENTS_INVALID", "Document arguments are invalid.");
  }
  const format = value.format as LocalDocumentFormat;
  if (path.extname(value.fileName).toLocaleLowerCase() !== `.${format}`) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_EXTENSION_MISMATCH", "File name extension does not match the requested format.");
  }
  return {
    format,
    fileName: value.fileName.normalize("NFC"),
    title: value.title,
    content: value.content,
    rows: parseRows(value.rows),
  };
}

function permissionAllowsLocalDocumentCreation(permissions: ResolvedPermissions) {
  const rules = permissions.rules.filter((rule) => rule.ruleId === "tools.execute" && rule.action === "execute");
  if (rules.some((rule) => rule.effect === "deny")) return false;
  return rules.some((rule) => rule.effect === "allow");
}

function canonicalInput(input: CreateArguments) {
  return JSON.stringify({
    format: input.format,
    fileName: input.fileName,
    title: input.title,
    content: input.content,
    rows: input.rows ?? null,
  });
}

function artifactId(callId: string, relativePath: string) {
  const digest = createHash("sha256").update(`${callId}\0${relativePath}`).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function artifactFromReceipt(receipt: Receipt, projectId: string): DocumentArtifact {
  const encodedPath = encodeURIComponent(receipt.relativePath.split(path.sep).join("/"));
  const fileRoute = `/api/projects/${projectId}/files?path=${encodedPath}`;
  return Object.freeze({
    id: artifactId(receipt.callId, receipt.relativePath),
    type: "document",
    name: path.basename(receipt.relativePath),
    url: `${fileRoute}&raw=1&download=1`,
    kind: receipt.format,
    mimeType: receipt.mimeType,
    size: receipt.size,
    status: "ready",
    pages: receipt.pages,
    previewUrl: receipt.format === "pdf" ? `${fileRoute}&raw=1` : `${fileRoute}&representation=1`,
    publicationStatus: null,
    publicationError: null,
    targetLabel: receipt.relativePath,
    error: null,
  });
}

function responseFor(receipt: Receipt): DynamicToolCallResponse {
  return {
    success: true,
    contentItems: [{
      type: "inputText",
      text: JSON.stringify({
        status: "created",
        storage: "local-private-workspace",
        externalConnectorUsed: false,
        path: receipt.relativePath,
        format: receipt.format,
        mimeType: receipt.mimeType,
        size: receipt.size,
        sha256: receipt.sha256,
        pages: receipt.pages,
      }),
    }],
  };
}

function failure(
  code: string,
  message: string,
  status: "failed" | "indeterminate" = "failed",
): LocalDocumentDynamicToolResult {
  return {
    response: {
      success: false,
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({ status, code, message, externalConnectorUsed: false }),
      }],
    },
    artifact: null,
  };
}

function receiptValue(value: unknown): Receipt {
  if (!isRecord(value)) throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_RECEIPT_INVALID", "Document receipt is invalid.");
  exactKeys(value, [
    "schemaVersion", "installationId", "userId", "projectId", "runtimeThreadId", "runtimeTurnId", "callId",
    "inputFingerprint", "relativePath", "format", "mimeType", "size", "sha256", "pages", "createdAt",
  ]);
  if (value.schemaVersion !== 1 || typeof value.installationId !== "string" || typeof value.userId !== "string" ||
      typeof value.projectId !== "string" || typeof value.runtimeThreadId !== "string" || typeof value.runtimeTurnId !== "string" ||
      typeof value.callId !== "string" || typeof value.inputFingerprint !== "string" || typeof value.relativePath !== "string" ||
      typeof value.format !== "string" || !FORMATS.includes(value.format as LocalDocumentFormat) || typeof value.mimeType !== "string" ||
      typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 64 || typeof value.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.sha256) || (value.pages !== null && (!Number.isSafeInteger(value.pages) || (value.pages as number) < 1)) ||
      typeof value.createdAt !== "string" || Number.isNaN(new Date(value.createdAt).valueOf())) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_RECEIPT_INVALID", "Document receipt fields are invalid.");
  }
  return value as Receipt;
}

async function secureDirectory(workspace: string) {
  const canonicalWorkspace = await realpath(workspace);
  const documents = path.join(workspace, "documents");
  await mkdir(documents, { recursive: true, mode: 0o700 });
  const metadata = await lstat(documents);
  const canonicalDocuments = await realpath(documents);
  const relative = path.relative(canonicalWorkspace, canonicalDocuments);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_PATH_UNSAFE", "Private document directory is unsafe.");
  }
  return documents;
}

async function availableTarget(documents: string, fileName: string) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const name = suffix === 0 ? fileName : `${stem}-${suffix + 1}${extension}`;
    const target = path.join(documents, name);
    try {
      await lstat(target);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return { name, target };
      throw error;
    }
  }
  throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_NAME_EXHAUSTED", "No safe file name is available.");
}

async function readReceipt(filePath: string) {
  try {
    return receiptValue(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function verifyReceipt(receipt: Receipt, inputFingerprint: string, context: LocalDocumentDynamicToolContext) {
  if (receipt.installationId !== context.installationId || receipt.userId !== context.userId || receipt.projectId !== context.projectId ||
      receipt.runtimeThreadId !== context.runtimeThreadId || receipt.runtimeTurnId !== context.runtimeTurnId || receipt.inputFingerprint !== inputFingerprint) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_RECEIPT_CONFLICT", "Document call receipt does not match this authenticated turn.");
  }
  const contents = await readRegularFileWithin(context.projectWorkspace, receipt.relativePath, 20_000_000);
  if (contents.length !== receipt.size || createHash("sha256").update(contents).digest("hex") !== receipt.sha256) {
    throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_RECEIPT_CORRUPT", "Previously created document no longer matches its receipt.");
  }
  validateUploadedDocument({ fileName: path.basename(receipt.relativePath), declaredMimeType: receipt.mimeType, data: contents });
}

export async function handleLocalDocumentDynamicToolCall(
  params: DynamicToolCallParams,
  context: LocalDocumentDynamicToolContext,
): Promise<LocalDocumentDynamicToolResult> {
  try {
    if (!isRecord(params)) throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_REQUEST_INVALID", "Document tool request is invalid.");
    exactKeys(params, ["threadId", "turnId", "callId", "namespace", "tool", "arguments"]);
    if (params.namespace !== AIBRAIN_DOCUMENT_TOOL_NAMESPACE || params.tool !== "create") {
      throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_TOOL_REJECTED", "Document tool is not in the closed allowlist.");
    }
    for (const value of [params.threadId, params.turnId, params.callId]) {
      if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
        throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_REQUEST_INVALID", "Document tool identity is invalid.");
      }
    }
    if (!UUID_PATTERN.test(context.userId) || !UUID_PATTERN.test(context.projectId) ||
        params.threadId !== context.runtimeThreadId || params.turnId !== context.runtimeTurnId ||
        context.permissions.installationId !== context.installationId || context.permissions.userId !== context.userId ||
        context.permissions.projectId !== context.projectId) {
      throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_IDENTITY_MISMATCH", "Document tool call does not belong to this turn.");
    }
    if (!permissionAllowsLocalDocumentCreation(context.permissions)) {
      return failure("LOCAL_DOCUMENT_PERMISSION_DENIED", "La política de este usuario no permite crear archivos locales.");
    }
    const input = parseArguments(params.arguments);
    const inputFingerprint = createHash("sha256").update(canonicalInput(input)).digest("hex");
    const receiptName = `${createHash("sha256").update(params.callId).digest("hex")}.json`;
    const receiptPath = path.join(context.receiptRoot, receiptName);
    await mkdir(context.receiptRoot, { recursive: true, mode: 0o700 });
    const claimPath = path.join(context.receiptRoot, `${receiptName}.claim`);
    let claimed = false;
    try {
      await mkdir(claimPath, { mode: 0o700 });
      claimed = true;
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
      const existing = await readReceipt(receiptPath);
      if (!existing) {
        return failure(
          "LOCAL_DOCUMENT_CALL_INDETERMINATE",
          "La creación de este documento ya está en curso o quedó en un estado incierto; no se repetirá automáticamente.",
          "indeterminate",
        );
      }
      await verifyReceipt(existing, inputFingerprint, context);
      return { response: responseFor(existing), artifact: artifactFromReceipt(existing, context.projectId) };
    }
    try {
      const existing = await readReceipt(receiptPath);
      if (existing) {
        await verifyReceipt(existing, inputFingerprint, context);
        return { response: responseFor(existing), artifact: artifactFromReceipt(existing, context.projectId) };
      }
      const documents = await secureDirectory(context.projectWorkspace);
      const generated = await generateLocalDocument(input);
      validateUploadedDocument({ fileName: input.fileName, declaredMimeType: generated.mimeType, data: generated.data });
      const selected = await availableTarget(documents, input.fileName);
      let written = false;
      try {
        // This runtime-owned, ACL-validated workspace path must not make the
        // production bundler trace the repository as a build-time asset.
        const handle = await open(/* turbopackIgnore: true */ selected.target, "wx", 0o600);
        try {
          await handle.writeFile(generated.data);
          await handle.sync();
          written = true;
        } finally {
          await handle.close();
        }
        const relativePath = path.posix.join("documents", selected.name);
        const verified = await readRegularFileWithin(context.projectWorkspace, relativePath, 20_000_000);
        const verifiedDocument = validateUploadedDocument({ fileName: selected.name, declaredMimeType: generated.mimeType, data: verified });
        if (verified.length !== generated.data.length || verifiedDocument.sha256 !== generated.sha256) {
          throw new LocalDocumentDynamicToolError("LOCAL_DOCUMENT_VERIFY_FAILED", "Created document failed server readback.");
        }
        const receipt: Receipt = Object.freeze({
          schemaVersion: 1,
          installationId: context.installationId,
          userId: context.userId,
          projectId: context.projectId,
          runtimeThreadId: context.runtimeThreadId,
          runtimeTurnId: context.runtimeTurnId,
          callId: params.callId,
          inputFingerprint,
          relativePath,
          format: generated.format,
          mimeType: generated.mimeType,
          size: verified.length,
          sha256: generated.sha256,
          pages: generated.pages,
          createdAt: (context.now ?? (() => new Date()))().toISOString(),
        });
        await atomicWriteFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
        return { response: responseFor(receipt), artifact: artifactFromReceipt(receipt, context.projectId) };
      } catch (error) {
        if (written) await rm(selected.target, { force: true }).catch(() => undefined);
        throw error;
      }
    } finally {
      if (claimed) await rm(claimPath, { recursive: true, force: false }).catch(() => undefined);
    }
  } catch (error) {
    return error instanceof LocalDocumentDynamicToolError
      ? failure(error.code, error.message)
      : failure("LOCAL_DOCUMENT_GENERATION_FAILED", "No se ha podido crear y verificar el documento local.");
  }
}
