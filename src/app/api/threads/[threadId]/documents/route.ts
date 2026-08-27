import { NextResponse } from "next/server";
import { operationalLogger } from "@/operations/server-logger";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { loadInstallationConfig } from "@/config/installation";
import { parseStreamingDocumentUpload, type ParsedDocumentUpload } from "@/documents/multipart-upload";
import { documentServicesForUser } from "@/documents/server-service";
import { UploadValidationError, validateUploadedDocumentFile } from "@/documents/upload-validation";
import { StorageError } from "@/storage";
import { workbenchErrorResponse } from "@/workbench/http";
import { getThreadRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ threadId: string }> };

function documentErrorResponse(error: unknown) {
  const code = error instanceof UploadValidationError || error instanceof StorageError
    ? error.code
    : "DOCUMENT_UPLOAD_FAILED";
  operationalLogger.warn("document.upload_rejected", { code });
  if (code === "UPLOAD_SIZE_INVALID") {
    return NextResponse.json({ error: "El document supera el límit de seguretat." }, { status: 413 });
  }
  if (code === "STORAGE_STAGING_ID_CONFLICT" || code === "DOCUMENT_PREVIEW_CONFLICT") {
    return NextResponse.json({ error: "Aquest uploadId ja identifica un altre document." }, { status: 409 });
  }
  if (code === "DOCUMENT_CONVERSION_BACKPRESSURE") {
    const retryAfterMs = error && typeof error === "object" && "retryAfterMs" in error &&
      typeof error.retryAfterMs === "number" ? error.retryAfterMs : 1_000;
    return NextResponse.json(
      { error: "La conversió de documents està ocupada. Torna-ho a provar." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) },
      },
    );
  }
  if (code.startsWith("UPLOAD_") || code === "STORAGE_STAGING_ID_INVALID") {
    return NextResponse.json({ error: "El document no supera la validació de seguretat." }, { status: 400 });
  }
  return NextResponse.json({ error: "No s’ha pogut preparar el document." }, { status: 503 });
}

export async function POST(request: Request, context: RouteContext) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { threadId } = await context.params;
  if (!isUuid(threadId)) return NextResponse.json({ error: "Fil no vàlid." }, { status: 400 });

  let parsed: ParsedDocumentUpload | null = null;
  try {
    await getThreadRuntimeContext(session, threadId);
    const installation = await loadInstallationConfig();
    if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
      return NextResponse.json({ error: "La sessió no pertany a aquesta instal·lació." }, { status: 403 });
    }
    const services = await documentServicesForUser(installation, session.user.id);
    parsed = await parseStreamingDocumentUpload(request, services.staging.rootDirectory);
    const parsedUpload = parsed;
    if (!isUuid(parsedUpload.uploadId)) {
      throw new UploadValidationError("UPLOAD_MULTIPART_CONTRACT_INVALID", "uploadId must be a UUID.");
    }
    const validated = await validateUploadedDocumentFile({
      fileName: parsedUpload.fileName,
      declaredMimeType: parsedUpload.declaredMimeType,
      filePath: parsedUpload.temporaryPath,
    });
    if (validated.size !== parsedUpload.size) {
      throw new UploadValidationError("UPLOAD_SOURCE_CHANGED", "Upload size changed before validation.");
    }
    const document = await services.staging.stageFile({
      threadId,
      uploadId: parsedUpload.uploadId,
      validated,
      sourcePath: parsedUpload.temporaryPath,
    });
    const preview = await services.previews.create(document, { signal: request.signal });
    return NextResponse.json({
      document,
      preview: {
        ...preview,
        files: preview.files.map((name) => ({
          name,
          url: `/api/threads/${threadId}/documents/${parsedUpload.uploadId}/preview/${encodeURIComponent(name)}`,
        })),
      },
    }, { status: 201 });
  } catch (error) {
    if (!(error instanceof UploadValidationError) && !(error instanceof StorageError)) {
      return workbenchErrorResponse(error, "No s’ha pogut verificar el fil del document.");
    }
    return documentErrorResponse(error);
  } finally {
    await parsed?.dispose();
  }
}
