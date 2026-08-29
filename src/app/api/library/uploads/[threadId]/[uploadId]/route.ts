import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { documentServicesForUser } from "@/documents/server-service";
import { contentDisposition } from "@/library/http";
import { readRegularFileWithin } from "@/security/safe-file";
import { StorageError } from "@/storage";
import { getThread } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string; uploadId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { threadId, uploadId } = await context.params;
  if (!isUuid(threadId) || !isUuid(uploadId)) {
    return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  }
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "inline") || params.getAll("inline").length > 1 ||
      (params.has("inline") && params.get("inline") !== "1")) {
    return NextResponse.json({ error: "Consulta no válida." }, { status: 400 });
  }
  try {
    if (session.provider !== "local") {
      return NextResponse.json({ error: "La descarga requiere el runtime privado." }, { status: 403 });
    }
    const thread = await getThread(session, threadId);
    const attachment = thread.messages.flatMap((message) => message.attachments)
      .find((candidate) => candidate.id === uploadId);
    if (!attachment) return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
    const installation = await loadInstallationConfig();
    if (installation.installationId !== session.tenant.id) {
      return NextResponse.json({ error: "La sessió no pertany a aquesta instal·lació." }, { status: 403 });
    }
    const services = await documentServicesForUser(installation, session.user.id);
    const resolved = await services.staging.resolveContentById(threadId, uploadId);
    if (resolved.document.fileName !== attachment.name || resolved.document.mediaType !== attachment.mimeType ||
        resolved.document.size !== attachment.size) {
      return NextResponse.json({ error: "El archivo ya no coincide con su registro." }, { status: 409 });
    }
    const contents = await readRegularFileWithin(
      services.staging.rootDirectory,
      resolved.document.relativePath,
      50 * 1024 * 1024,
    );
    const inline = params.get("inline") === "1";
    return new Response(new Uint8Array(contents), {
      headers: {
        "Content-Type": resolved.document.mediaType,
        "Content-Length": String(contents.byteLength),
        "Content-Disposition": contentDisposition(resolved.document.fileName, inline ? "inline" : "attachment"),
        "Cache-Control": "private, no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        ...(inline ? { "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } : {}),
      },
    });
  } catch (error) {
    if (error instanceof StorageError) {
      return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }
}
