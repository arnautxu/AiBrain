import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { documentServicesForUser } from "@/documents/server-service";
import { StorageError } from "@/storage";
import { workbenchErrorResponse } from "@/workbench/http";
import { getThreadRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ threadId: string; uploadId: string; fileName: string }>;
};

function mediaType(fileName: string) {
  if (fileName.endsWith(".pdf")) return "application/pdf";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".gif")) return "image/gif";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "text/plain; charset=utf-8";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { threadId, uploadId, fileName } = await context.params;
  if (!isUuid(threadId) || !isUuid(uploadId) ||
      !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(fileName)) {
    return NextResponse.json({ error: "Preview no vàlid." }, { status: 400 });
  }
  try {
    await getThreadRuntimeContext(session, threadId);
    const installation = await loadInstallationConfig();
    if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
      return NextResponse.json({ error: "La sessió no pertany a aquesta instal·lació." }, { status: 403 });
    }
    const services = await documentServicesForUser(installation, session.user.id);
    const data = await services.previews.readFile(threadId, uploadId, fileName);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mediaType(fileName),
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    if ((error instanceof StorageError && error.code === "DOCUMENT_PREVIEW_FILE_NOT_FOUND") ||
        isNodeError(error, "ENOENT")) {
      return NextResponse.json({ error: "Preview no trobat." }, { status: 404 });
    }
    return workbenchErrorResponse(error, "No s’ha pogut llegir el preview.");
  }
}
