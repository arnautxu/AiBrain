import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { loadInstallationConfig } from "@/config/installation";
import { documentServicesForUser } from "@/documents/server-service";
import { UploadValidationError, validateUploadedDocument } from "@/documents/upload-validation";
import { StorageError } from "@/storage";
import { workbenchErrorResponse } from "@/workbench/http";
import { getThreadRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";
const MAX_MULTIPART_BYTES = 52 * 1024 * 1024;

type RouteContext = { params: Promise<{ threadId: string }> };

function documentErrorResponse(error: unknown) {
  const code = error instanceof UploadValidationError || error instanceof StorageError
    ? error.code
    : "DOCUMENT_UPLOAD_FAILED";
  console.error("AiBrain document upload rejected", { code });
  if (code === "UPLOAD_SIZE_INVALID") {
    return NextResponse.json({ error: "El document supera el límit de seguretat." }, { status: 413 });
  }
  if (code === "STORAGE_STAGING_ID_CONFLICT" || code === "DOCUMENT_PREVIEW_CONFLICT") {
    return NextResponse.json({ error: "Aquest uploadId ja identifica un altre document." }, { status: 409 });
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
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: "La petició supera el límit de seguretat." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "El multipart no és vàlid." }, { status: 400 });
  }
  const keys = [...form.keys()];
  const uploadId = form.get("uploadId");
  const file = form.get("file");
  if (keys.length !== 2 || new Set(keys).size !== 2 ||
      typeof uploadId !== "string" || !isUuid(uploadId) || !(file instanceof File)) {
    return NextResponse.json({ error: "El contracte d’upload no és vàlid." }, { status: 400 });
  }
  if (file.size < 1 || file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "El document supera el límit de seguretat." }, { status: 413 });
  }

  try {
    await getThreadRuntimeContext(session, threadId);
    const installation = await loadInstallationConfig();
    if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
      return NextResponse.json({ error: "La sessió no pertany a aquesta instal·lació." }, { status: 403 });
    }
    const data = Buffer.from(await file.arrayBuffer());
    const validated = validateUploadedDocument({
      fileName: file.name,
      declaredMimeType: file.type,
      data,
    });
    const services = await documentServicesForUser(installation, session.user.id);
    const document = await services.staging.stage({ threadId, uploadId, validated, data });
    const preview = await services.previews.create(document);
    return NextResponse.json({
      document,
      preview: {
        ...preview,
        files: preview.files.map((name) => ({
          name,
          url: `/api/threads/${threadId}/documents/${uploadId}/preview/${encodeURIComponent(name)}`,
        })),
      },
    }, { status: 201 });
  } catch (error) {
    if (!(error instanceof UploadValidationError) && !(error instanceof StorageError)) {
      return workbenchErrorResponse(error, "No s’ha pogut verificar el fil del document.");
    }
    return documentErrorResponse(error);
  }
}
